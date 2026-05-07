import { AddLaboratoryRun } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryDataTaggingService } from './laboratory-data-tagging-service';

/**
 * Best-effort hook that records the file -> workflow association in the laboratory data
 * tagging table when a run is created. Shared by create-laboratory-run and maintenance scripts.
 *
 * Failures are logged and swallowed — tagging must not break run creation.
 */
export async function associateInputsWithWorkflowTag(args: {
  laboratory: Laboratory;
  userId: string;
  request: AddLaboratoryRun;
  tagging: LaboratoryDataTaggingService;
}): Promise<void> {
  const { laboratory, userId, request, tagging } = args;
  try {
    const inputKeys = (request.InputFileKeys || []).filter((k) => typeof k === 'string' && k.length > 0);
    if (!inputKeys.length) return;
    if (!request.WorkflowExternalId) return;
    if (!laboratory.S3Bucket) return;

    const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const labScopedKeys = inputKeys.filter((k) => k.startsWith(labPrefix));
    if (!labScopedKeys.length) return;

    const tag = await tagging.getOrCreateWorkflowTag(laboratory, userId, {
      platform: request.Platform,
      externalId: request.WorkflowExternalId,
      versionName: request.WorkflowVersionName,
      name: request.WorkflowName?.trim() || request.WorkflowExternalId,
    });

    await tagging.applyWorkflowToFiles(laboratory, userId, tag.TagId, laboratory.S3Bucket, labScopedKeys);
  } catch (err) {
    console.warn('Failed to associate input files with workflow tag (continuing):', err);
  }
}
