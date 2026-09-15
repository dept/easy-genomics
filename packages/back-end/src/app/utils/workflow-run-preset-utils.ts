import { UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { WorkflowRunPresetScope } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

/**
 * Sort key builders for the workflow-run-preset-table.
 *
 * Personal and laboratory presets share one partition (the LaboratoryId) and are
 * separated by their sort key prefix, so the run form can load each tier with a
 * single `begins_with` query and no secondary index:
 *
 *   USER#<UserId>#<WorkflowId>#<PresetId>
 *   LAB#<WorkflowId>#<PresetId>
 */

export function userPresetKeyPrefix(userId: string, workflowId: string): string {
  return `USER#${userId}#${workflowId}#`;
}

export function labPresetKeyPrefix(workflowId: string): string {
  return `LAB#${workflowId}#`;
}

export function workflowRunPresetKeyPrefix(scope: WorkflowRunPresetScope, userId: string, workflowId: string): string {
  return scope === 'LAB' ? labPresetKeyPrefix(workflowId) : userPresetKeyPrefix(userId, workflowId);
}

export function workflowRunPresetKey(
  scope: WorkflowRunPresetScope,
  userId: string,
  workflowId: string,
  presetId: string,
): string {
  return `${workflowRunPresetKeyPrefix(scope, userId, workflowId)}${presetId}`;
}

/**
 * Resolves the Laboratory and asserts the caller may read and write its presets.
 *
 * Presets are a run-configuration convenience rather than privileged data, so any
 * active member of the laboratory may manage both their own and the shared lab
 * presets — matching who is already allowed to launch a run there.
 */
export async function authorizeLaboratoryPresetAccess(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  laboratoryService: LaboratoryService,
  laboratoryId: string,
): Promise<Laboratory> {
  const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

  if (
    !(
      validateSystemAdminAccess(event) ||
      validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
      validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
      validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
    )
  ) {
    throw new UnauthorizedAccessError();
  }

  return laboratory;
}
