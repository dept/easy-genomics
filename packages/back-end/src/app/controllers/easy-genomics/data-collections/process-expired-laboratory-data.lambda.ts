import { Handler, ScheduledEvent } from 'aws-lambda';
import {
  LaboratoryDataRetentionService,
  RetentionSweepOptions,
  emptyRetentionSweepStats,
} from '@BE/services/easy-genomics/laboratory-data-retention-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';

const laboratoryService = new LaboratoryService();
const retentionService = new LaboratoryDataRetentionService();

const METRIC_NAMESPACE = 'EasyGenomics/DataRetention';

const DEFAULT_MAX_DELETES_PER_LAB_SWEEP = 25_000;
const DEFAULT_MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP = 500;

/**
 * Scheduled (daily) Lambda that performs the S3 deletion half of the run-retention cascade. The
 * policy itself lives in `LaboratoryDataRetentionService`; this handler reads configuration,
 * iterates laboratories and emits metrics.
 *
 * Three independent env flags stage the destructive behaviour, each defaulting to the safe value
 * so a deploy never starts deleting on its own:
 *   - `DRY_RUN` — only the literal `false` enables real deletes; anything else audits.
 *   - `OUTPUT_DELETION_ENABLED` — `true` enables deleting recorded run outputs and sample sheets.
 *   - `ORPHAN_RECONCILIATION_ENABLED` — `true` enables discovering outputs left behind by runs
 *     that expired before this cascade existed. This is the backlog pass and covers data that
 *     predates the feature, so it is staged separately from the go-forward path above.
 *
 * `MAX_DELETES_PER_LAB_SWEEP` caps objects deleted per lab per invocation (shared across input
 * files and outputs); `0` is a kill switch. `MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP` caps how many
 * previously-unseen run folders one invocation inspects per lab. Metrics are emitted as
 * CloudWatch EMF under `EasyGenomics/DataRetention`.
 *
 * Triggered by an EventBridge Scheduled Rule (see `easy-genomics-nested-stack.ts`).
 */
export const handler: Handler<ScheduledEvent, void> = async (event: ScheduledEvent): Promise<void> => {
  const options: RetentionSweepOptions = {
    dryRun: process.env.DRY_RUN !== 'false',
    maxDeletesPerLab: parseNumericEnv('MAX_DELETES_PER_LAB_SWEEP', DEFAULT_MAX_DELETES_PER_LAB_SWEEP),
    maxOrphanFoldersPerLab: parseNumericEnv(
      'MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP',
      DEFAULT_MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP,
    ),
    outputDeletionEnabled: process.env.OUTPUT_DELETION_ENABLED === 'true',
    orphanReconciliationEnabled: process.env.ORPHAN_RECONCILIATION_ENABLED === 'true',
  };

  console.log('Starting expired laboratory data sweep', { ...options, eventId: event?.id, time: event?.time });

  const totals = emptyRetentionSweepStats();
  let labsHitDeleteCap = 0;

  const laboratories = await laboratoryService.listAllLaboratories();
  for (const laboratory of laboratories) {
    try {
      const stats = await retentionService.sweepLaboratory(laboratory, options);
      totals.eligible += stats.eligible;
      totals.deleted += stats.deleted;
      totals.permanentProtected += stats.permanentProtected;
      totals.outputPrefixesDeleted += stats.outputPrefixesDeleted;
      totals.outputObjectsDeleted += stats.outputObjectsDeleted;
      totals.outputObjectsProtected += stats.outputObjectsProtected;
      totals.sampleSheetsDeleted += stats.sampleSheetsDeleted;
      totals.outputPrefixesSkippedInUse += stats.outputPrefixesSkippedInUse;
      totals.orphanFoldersScanned += stats.orphanFoldersScanned;
      totals.orphanFoldersRecorded += stats.orphanFoldersRecorded;
      totals.errors += stats.errors;
      if (stats.hitDeleteCap) labsHitDeleteCap++;
    } catch (err) {
      console.error(`Sweep failed for lab ${laboratory.LaboratoryId} (continuing):`, err);
      totals.errors++;
    }
  }

  console.log('Expired laboratory data sweep summary:', {
    ...options,
    laboratories: laboratories.length,
    ...totals,
    labsHitDeleteCap,
  });

  emitEmfMetrics({
    Eligible: totals.eligible,
    Deleted: totals.deleted,
    PermanentProtected: totals.permanentProtected,
    OutputPrefixesDeleted: totals.outputPrefixesDeleted,
    OutputObjectsDeleted: totals.outputObjectsDeleted,
    OutputObjectsProtected: totals.outputObjectsProtected,
    SampleSheetsDeleted: totals.sampleSheetsDeleted,
    OutputPrefixesSkippedInUse: totals.outputPrefixesSkippedInUse,
    OrphanFoldersScanned: totals.orphanFoldersScanned,
    OrphanFoldersRecorded: totals.orphanFoldersRecorded,
    Errors: totals.errors,
    LabsHitDeleteCap: labsHitDeleteCap,
  });
};

/** Falls back to `fallback` for unset, empty, malformed or negative values. `0` is honoured. */
function parseNumericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * Emit a CloudWatch Embedded Metric Format (EMF) record so the metrics show up in CloudWatch
 * without taking a runtime dependency on `@aws-sdk/client-cloudwatch`. EMF is just a JSON
 * shape on a single log line that the CloudWatch agent recognises.
 */
function emitEmfMetrics(metrics: Record<string, number>): void {
  const metricNames = Object.keys(metrics);
  if (metricNames.length === 0) return;
  console.log(
    JSON.stringify({
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
    }),
  );
}
