import { LaboratoryRunUsageSummary } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryDataTaggingService } from './laboratory-data-tagging-service';

/**
 * Best-effort hook that records the file -> workflow association and per-file run usage history
 * in the laboratory data tagging table when a run is created. Shared by create-laboratory-run and
 * maintenance scripts.
 *
 * Run usage is recorded for every laboratory run with lab-scoped `InputFileKeys`, even when the run
 * has no `WorkflowExternalId` (so the data collections "Analysis History" tooltip can still display
 * the run with its name and creation date). Workflow tagging only runs when `WorkflowExternalId`
 * is present.
 *
 * Failures are logged and swallowed — tagging must not break run creation.
 */
export async function associateInputsWithWorkflowTag(args: {
  laboratory: Laboratory;
  userId: string;
  run: LaboratoryRun;
  tagging: LaboratoryDataTaggingService;
}): Promise<void> {
  const { laboratory, userId, run, tagging } = args;
  try {
    const inputKeys = (run.InputFileKeys || []).filter((k) => typeof k === 'string' && k.length > 0);
    if (!inputKeys.length) return;
    if (!laboratory.S3Bucket) return;

    const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const labScopedKeys = inputKeys.filter((k) => k.startsWith(labPrefix));
    if (!labScopedKeys.length) return;

    if (run.WorkflowExternalId) {
      const tag = await tagging.getOrCreateWorkflowTag(laboratory, userId, {
        platform: run.Platform,
        externalId: run.WorkflowExternalId,
        versionName: run.WorkflowVersionName,
        name: run.WorkflowName?.trim() || run.WorkflowExternalId,
      });

      await tagging.applyWorkflowToFiles(laboratory, userId, tag.TagId, laboratory.S3Bucket, labScopedKeys);
    }

    const summary: LaboratoryRunUsageSummary = {
      RunId: run.RunId,
      RunName: run.RunName,
      ...(run.WorkflowName?.trim() ? { WorkflowName: run.WorkflowName.trim() } : {}),
      RunCreatedAt: run.CreatedAt ?? new Date().toISOString(),
      InputFileCount: labScopedKeys.length,
      InputFileKeys: labScopedKeys,
      // Mirror the run's current `ExpiresAt` (when known) onto every per-file usage entry so
      // the data collections page can compute "Expiring soon" without a second round trip
      // to the run table. When the run is not yet terminal or retention is disabled this is
      // left undefined; the value is patched on the file rows when the run later transitions
      // to a terminal status (see `updateRunUsageExpiresAt`).
      ...(typeof run.ExpiresAt === 'number' ? { ExpiresAt: run.ExpiresAt } : {}),
    };

    await tagging.recordLaboratoryRunInputUsage(laboratory, userId, laboratory.S3Bucket, labScopedKeys, summary);
  } catch (err) {
    console.warn('Failed to associate laboratory run inputs with data tagging (continuing):', err);
  }
}
