import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { Handler, ScheduledEvent } from 'aws-lambda';
import {
  LaboratoryDataTaggingService,
  permanentTagIdForLaboratory,
} from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';

const laboratoryService = new LaboratoryService();
const dataTaggingService = new LaboratoryDataTaggingService();
const s3Service = new S3Service();

const METRIC_NAMESPACE = 'EasyGenomics/DataRetention';

/**
 * Scheduled (daily) Lambda that performs the S3 deletion half of the run-retention cascade
 * described in the "Permanent tag and S3 expiry" plan.
 *
 * Eligibility for deletion (per file row in the data tagging table):
 *   1. `LaboratoryRunUsages` is empty or absent
 *      (the DynamoDB-stream subscriber removes usages as their run rows TTL out).
 *   2. The file row carries at least one workflow tag id in `TagIds`
 *      — proves the file was once associated with a run; distinguishes "expired" from
 *      "never-used orphan" (orphans are intentionally NOT auto-deleted per the plan).
 *   3. The file row does NOT carry the laboratory's singleton permanent tag id.
 *
 * Honors a DRY_RUN env flag for safe initial deploys; emits CloudWatch metrics under the
 * `EasyGenomics/DataRetention` namespace.
 *
 * Triggered by an EventBridge Scheduled Rule (see `easy-genomics-nested-stack.ts`).
 */
export const handler: Handler<ScheduledEvent, void> = async (event: ScheduledEvent): Promise<void> => {
  const dryRun = (process.env.DRY_RUN ?? '').toLowerCase() === 'true';
  console.log(`Starting expired laboratory data sweep (dryRun=${dryRun})`, {
    eventId: event?.id,
    time: event?.time,
  });

  let totalEligible = 0;
  let totalDeleted = 0;
  let totalPermanentProtected = 0;
  let totalErrors = 0;

  const laboratories = await laboratoryService.listAllLaboratories();
  for (const lab of laboratories) {
    try {
      const stats = await sweepLaboratory(lab, dryRun);
      totalEligible += stats.eligible;
      totalDeleted += stats.deleted;
      totalPermanentProtected += stats.permanentProtected;
      totalErrors += stats.errors;
    } catch (err) {
      console.error(`Sweep failed for lab ${lab.LaboratoryId} (continuing):`, err);
      totalErrors++;
    }
  }

  console.log('Expired laboratory data sweep summary:', {
    dryRun,
    laboratories: laboratories.length,
    eligible: totalEligible,
    deleted: totalDeleted,
    permanentProtected: totalPermanentProtected,
    errors: totalErrors,
  });

  emitEmfMetrics({
    Eligible: totalEligible,
    Deleted: totalDeleted,
    PermanentProtected: totalPermanentProtected,
    Errors: totalErrors,
  });
};

/**
 * Lab-scoped sweep. Walks every FILE# row, evaluates eligibility, deletes the S3 object and
 * tagging-table rows when applicable. Per-lab errors are counted but do not abort the rest of
 * the sweep.
 */
async function sweepLaboratory(
  laboratory: Laboratory,
  dryRun: boolean,
): Promise<{ eligible: number; deleted: number; permanentProtected: number; errors: number }> {
  let eligible = 0;
  let deleted = 0;
  let permanentProtected = 0;
  let errors = 0;

  if (!laboratory.S3Bucket) {
    return { eligible, deleted, permanentProtected, errors };
  }

  const labPermanentTagId = permanentTagIdForLaboratory(laboratory.LaboratoryId);
  const { batchTagIds, workflowTagIds } = await loadKindIndexedTagIds(laboratory.LaboratoryId);

  const rows = await dataTaggingService.listAllFileRowsForLab(laboratory.LaboratoryId);

  for (const row of rows) {
    const tagIds = new Set<string>(row.TagIds || []);
    const isPermanent = tagIds.has(labPermanentTagId);
    const hasUsages = !!row.LaboratoryRunUsages && Object.keys(row.LaboratoryRunUsages).length > 0;
    const hasWorkflowTag = [...tagIds].some((id) => workflowTagIds.has(id));

    if (!hasWorkflowTag) continue; // Never-used orphan: not in scope for auto-delete.
    if (hasUsages) continue; // At least one run still retains this file.
    if (isPermanent) {
      permanentProtected++;
      continue;
    }

    eligible++;

    const bucket = row.S3Bucket || laboratory.S3Bucket;
    const key = row.ObjectKey;
    if (!bucket || !key) continue;

    if (dryRun) {
      console.log(`  [dry-run] Would delete s3://${bucket}/${key} (lab=${laboratory.LaboratoryId})`);
      continue;
    }

    try {
      await s3Service.deleteObject({ Bucket: bucket, Key: key });
      // Standard tag and batch tag refs are also gone with the FILE# row; their MAP# rows are
      // cleaned up inside `deleteFileRowAndAssociations`, which adjusts each TAG#'s FileCount.
      void batchTagIds; // keep lint happy; batch ids are not consulted here but loaded above
      await dataTaggingService.deleteFileRowAndAssociations(laboratory.LaboratoryId, row.Ref);
      deleted++;
    } catch (err) {
      console.warn(`  Error deleting s3://${bucket}/${key} (lab=${laboratory.LaboratoryId}):`, err);
      errors++;
    }
  }

  console.log(
    `Lab ${laboratory.LaboratoryId} sweep complete: eligible=${eligible} deleted=${deleted} permanentProtected=${permanentProtected} errors=${errors}`,
  );

  return { eligible, deleted, permanentProtected, errors };
}

/**
 * Loads the laboratory's batch + workflow tag id sets so the sweep can identify
 * workflow-tagged files without re-loading TAG# rows per file. Mirrors the partition logic in
 * `LaboratoryDataTaggingService.listFileTags`.
 */
async function loadKindIndexedTagIds(
  laboratoryId: string,
): Promise<{ batchTagIds: Set<string>; workflowTagIds: Set<string> }> {
  const { Tags } = await dataTaggingService.listTags(laboratoryId);
  const batchTagIds = new Set<string>();
  const workflowTagIds = new Set<string>();
  for (const t of Tags) {
    const kind = t.Kind ?? 'standard';
    if (kind === 'batch') batchTagIds.add(t.TagId);
    else if (kind === 'workflow' || !!(t.Platform && t.WorkflowExternalId)) workflowTagIds.add(t.TagId);
  }
  return { batchTagIds, workflowTagIds };
}

/**
 * Emit a CloudWatch Embedded Metric Format (EMF) record so the metrics show up in CloudWatch
 * without taking a runtime dependency on `@aws-sdk/client-cloudwatch`. EMF is just a JSON
 * shape on a single log line that the CloudWatch agent recognises.
 */
function emitEmfMetrics(metrics: Record<string, number>): void {
  const metricNames = Object.keys(metrics);
  if (metricNames.length === 0) return;
  const record = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [[]],
          Metrics: metricNames.map((name) => ({ Name: name, Unit: 'Count' as const })),
        },
      ],
    },
    ...metrics,
  };
  console.log(JSON.stringify(record));
}
