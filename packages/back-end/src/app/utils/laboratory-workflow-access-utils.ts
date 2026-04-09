import type { ShareDetails } from '@aws-sdk/client-omics';
import { WorkflowAccessDeniedError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import type { LaboratoryWorkflowAccess } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import {
  LaboratoryWorkflowAccessPlatform,
  LABORATORY_WORKFLOW_ACCESS_PLATFORMS,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';

export function laboratoryWorkflowAccessSortKey(
  platform: LaboratoryWorkflowAccessPlatform,
  workflowId: string,
): string {
  return `${platform}#${workflowId}`;
}

export function parseWorkflowAccessSortKey(workflowKey: string): {
  platform: LaboratoryWorkflowAccessPlatform;
  workflowId: string;
} | null {
  const idx = workflowKey.indexOf('#');
  if (idx <= 0) {
    return null;
  }
  const platform = workflowKey.slice(0, idx) as LaboratoryWorkflowAccessPlatform;
  if (!LABORATORY_WORKFLOW_ACCESS_PLATFORMS.includes(platform)) {
    return null;
  }
  const workflowId = workflowKey.slice(idx + 1);
  if (!workflowId) {
    return null;
  }
  return { platform, workflowId };
}

export function allowedWorkflowIdsForPlatform(
  accessList: LaboratoryWorkflowAccess[],
  platform: LaboratoryWorkflowAccessPlatform,
): Set<string> {
  const prefix = `${platform}#`;
  const ids = new Set<string>();
  for (const row of accessList) {
    if (!row.WorkflowKey.startsWith(prefix)) {
      continue;
    }
    const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
    if (parsed) {
      ids.add(parsed.workflowId);
    }
  }
  return ids;
}

export async function assertLaboratoryHasWorkflowAccess(
  laboratoryId: string,
  platform: LaboratoryWorkflowAccessPlatform,
  externalWorkflowId: string,
  accessService: LaboratoryWorkflowAccessService,
): Promise<void> {
  const rows = await accessService.listByLaboratoryId(laboratoryId);
  const allowed = allowedWorkflowIdsForPlatform(rows, platform);
  if (!allowed.has(externalWorkflowId)) {
    throw new WorkflowAccessDeniedError();
  }
}

export function workflowIdFromOmicsShare(share: ShareDetails): string | undefined {
  if (share.resourceId) {
    return share.resourceId;
  }
  const arn = share.resourceArn;
  if (!arn) {
    return undefined;
  }
  const idx = arn.lastIndexOf('/');
  if (idx === -1 || idx === arn.length - 1) {
    return undefined;
  }
  return arn.slice(idx + 1);
}
