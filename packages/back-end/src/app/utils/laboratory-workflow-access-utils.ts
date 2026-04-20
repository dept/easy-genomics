import type { ShareDetails } from '@aws-sdk/client-omics';
import { WorkflowAccessDeniedError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
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

/** Legacy rows and explicit ALLOW. */
export function rowIsAllow(row: LaboratoryWorkflowAccess): boolean {
  return row.Effect !== 'DENY';
}

export function rowIsDeny(row: LaboratoryWorkflowAccess): boolean {
  return row.Effect === 'DENY';
}

export function allowIdsForPlatform(
  accessList: LaboratoryWorkflowAccess[],
  platform: LaboratoryWorkflowAccessPlatform,
): Set<string> {
  const prefix = `${platform}#`;
  const ids = new Set<string>();
  for (const row of accessList) {
    if (!row.WorkflowKey.startsWith(prefix)) {
      continue;
    }
    if (!rowIsAllow(row)) {
      continue;
    }
    const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
    if (parsed) {
      ids.add(parsed.workflowId);
    }
  }
  return ids;
}

export function denyIdsForPlatform(
  accessList: LaboratoryWorkflowAccess[],
  platform: LaboratoryWorkflowAccessPlatform,
): Set<string> {
  const prefix = `${platform}#`;
  const ids = new Set<string>();
  for (const row of accessList) {
    if (!row.WorkflowKey.startsWith(prefix)) {
      continue;
    }
    if (!rowIsDeny(row)) {
      continue;
    }
    const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
    if (parsed) {
      ids.add(parsed.workflowId);
    }
  }
  return ids;
}

/** @deprecated Use allowIdsForPlatform — same behavior for ALLOW-only rows */
export function allowedWorkflowIdsForPlatform(
  accessList: LaboratoryWorkflowAccess[],
  platform: LaboratoryWorkflowAccessPlatform,
): Set<string> {
  return allowIdsForPlatform(accessList, platform);
}

export function isWorkflowAccessAllowed(
  laboratory: Pick<Laboratory, 'EnableNewWorkflowsByDefault'>,
  accessRows: LaboratoryWorkflowAccess[],
  platform: LaboratoryWorkflowAccessPlatform,
  workflowId: string,
): boolean {
  const defaultOn = laboratory.EnableNewWorkflowsByDefault === true;
  if (!defaultOn) {
    return allowIdsForPlatform(accessRows, platform).has(workflowId);
  }
  return !denyIdsForPlatform(accessRows, platform).has(workflowId);
}

export async function assertLaboratoryHasWorkflowAccess(
  laboratory: Pick<Laboratory, 'LaboratoryId' | 'EnableNewWorkflowsByDefault'>,
  platform: LaboratoryWorkflowAccessPlatform,
  externalWorkflowId: string,
  accessService: LaboratoryWorkflowAccessService,
): Promise<void> {
  const rows = await accessService.listByLaboratoryId(laboratory.LaboratoryId);
  if (!isWorkflowAccessAllowed(laboratory, rows, platform, externalWorkflowId)) {
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
