import { ConflictException, ResourceNotFoundException, WorkflowType } from '@aws-sdk/client-omics';
import { InvalidRequestError, OmicsWorkflowNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { OmicsService } from '@BE/services/omics-service';

export const WORKFLOW_IN_USE_MESSAGE = 'This workflow cannot be deleted while a run is using it.';

export type PrivateWorkflowDeleteClient = Pick<
  OmicsService,
  'deleteWorkflow' | 'deleteWorkflowVersion' | 'listWorkflowVersions'
>;

export function conflictIndicatesWorkflowInUse(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return /\brun\b|\bin use\b|\busing\b/.test(message);
}

export function conflictIndicatesWorkflowHasVersions(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('version');
}

/**
 * Collect every version name before mutating anything. Deleting while paginating
 * with the same nextToken can skip versions.
 */
export async function listAllWorkflowVersionNames(
  omicsService: PrivateWorkflowDeleteClient,
  workflowId: string,
): Promise<string[]> {
  const versionNames: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await omicsService.listWorkflowVersions({
      workflowId,
      type: WorkflowType.PRIVATE,
      maxResults: 100,
      startingToken: nextToken,
    });
    for (const version of page.items ?? []) {
      if (version.versionName) {
        versionNames.push(version.versionName);
      }
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return versionNames;
}

async function deleteListedWorkflowVersions(
  omicsService: PrivateWorkflowDeleteClient,
  workflowId: string,
  versionNames: string[],
): Promise<void> {
  for (const versionName of versionNames) {
    try {
      await omicsService.deleteWorkflowVersion({ workflowId, versionName });
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        continue;
      }
      if (error instanceof ConflictException) {
        throw new InvalidRequestError(WORKFLOW_IN_USE_MESSAGE);
      }
      throw error;
    }
  }
}

/**
 * Deletes a private HealthOmics workflow. Versions are removed only after
 * DeleteWorkflow fails with a conflict that clearly refers to versions — never
 * on an in-use or unknown conflict.
 */
export async function deletePrivateOmicsWorkflow(
  omicsService: PrivateWorkflowDeleteClient,
  workflowId: string,
): Promise<void> {
  const versionNames = await listAllWorkflowVersionNames(omicsService, workflowId);

  try {
    await omicsService.deleteWorkflow({ id: workflowId });
    return;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      throw new OmicsWorkflowNotFoundError(workflowId);
    }
    if (!(error instanceof ConflictException)) {
      throw error;
    }
    if (
      conflictIndicatesWorkflowInUse(error) ||
      !conflictIndicatesWorkflowHasVersions(error) ||
      versionNames.length === 0
    ) {
      throw new InvalidRequestError(WORKFLOW_IN_USE_MESSAGE);
    }
  }

  await deleteListedWorkflowVersions(omicsService, workflowId, versionNames);

  try {
    await omicsService.deleteWorkflow({ id: workflowId });
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return;
    }
    if (error instanceof ConflictException) {
      throw new InvalidRequestError(WORKFLOW_IN_USE_MESSAGE);
    }
    throw error;
  }
}
