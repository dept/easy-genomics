import { UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { isCompletedHealthOmicsWorkflowRun } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-delivery';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  WorkflowKeyOutput,
  WorkflowKeyOutputMicroreactDelivery,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { laboratoryPrefix, normalizeS3Prefix, parseS3Uri, type ParsedS3Uri } from '@BE/utils/s3-uri-utils';

/**
 * File Manager root used when declaring key outputs. Matches the run detail
 * explorer: OutputS3Url (else InputS3Url). HealthOmics only adds the
 * ExternalRunId folder when OutputS3Url is the chosen root. The prefix must
 * stay inside this run's laboratory folder, same as run export.
 */
export function runKeyOutputsRoot(run: LaboratoryRun): ParsedS3Uri | null {
  const sourceUri = run.OutputS3Url || run.InputS3Url;
  const parsed = parseS3Uri(sourceUri);
  if (!parsed?.bucket) return null;

  let prefix = parsed.prefix ? normalizeS3Prefix(parsed.prefix) : '';
  if (run.OutputS3Url && run.Platform === 'AWS HealthOmics' && run.ExternalRunId) {
    const externalFolder = `${run.ExternalRunId}/`;
    if (!prefix.endsWith(externalFolder)) {
      prefix = `${prefix}${externalFolder}`;
    }
  }
  if (!prefix || !prefix.startsWith(laboratoryPrefix(run))) return null;
  return { bucket: parsed.bucket, prefix };
}

export function toRunRelativePath(s3Key: string, rootPrefix: string): string | null {
  const trimmedKey = s3Key.trim().replace(/^\/+/, '');
  if (!trimmedKey || trimmedKey.startsWith('s3://') || trimmedKey.endsWith('/')) return null;

  const normalizedRoot = normalizeS3Prefix(rootPrefix);
  if (trimmedKey.startsWith(normalizedRoot)) {
    return trimmedKey.slice(normalizedRoot.length) || null;
  }

  // Already a run-relative path from the JSON editor or an earlier preview.
  return trimmedKey;
}

/** HealthOmics runs that finished successfully are the only ones that deliver key outputs. */
export function shouldEnqueueKeyOutputDelivery(
  run: Pick<LaboratoryRun, 'Platform' | 'Status' | 'WorkflowExternalId'>,
): boolean {
  return isCompletedHealthOmicsWorkflowRun(run);
}

export async function authorizeLaboratoryKeyOutputsAccess(
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

/** Lab managers, organisation admins, and system admins. Technicians cannot change delivery. */
export async function authorizeLaboratoryManagerKeyOutputsAccess(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  laboratoryService: LaboratoryService,
  laboratoryId: string,
): Promise<Laboratory> {
  const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

  if (
    !(
      validateSystemAdminAccess(event) ||
      validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
      validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
    )
  ) {
    throw new UnauthorizedAccessError();
  }

  return laboratory;
}

/**
 * Drops Microreact role IDs that are no longer declared key outputs. Returns
 * undefined when nothing remains to store, so an empty `{ Enabled: false }` is
 * not written. Auto-send turns off when the metadata role disappears.
 */
export function scrubMicroreactDeliveryRoles(
  microreact: WorkflowKeyOutputMicroreactDelivery | undefined,
  keyOutputs: WorkflowKeyOutput[],
): WorkflowKeyOutputMicroreactDelivery | undefined {
  if (!microreact) return undefined;

  const declared = new Set(keyOutputs.map((output) => output.KeyOutputId));
  const metadataId =
    microreact.MetadataKeyOutputId && declared.has(microreact.MetadataKeyOutputId)
      ? microreact.MetadataKeyOutputId
      : undefined;
  const treeIds = (microreact.TreeKeyOutputIds ?? []).filter((id) => declared.has(id) && id !== metadataId);
  const scrubbed: WorkflowKeyOutputMicroreactDelivery = {
    Enabled: Boolean(microreact.Enabled && metadataId),
    ...(metadataId ? { MetadataKeyOutputId: metadataId } : {}),
    ...(treeIds.length ? { TreeKeyOutputIds: treeIds } : {}),
  };

  if (!scrubbed.Enabled && !scrubbed.MetadataKeyOutputId && !scrubbed.TreeKeyOutputIds?.length) {
    return undefined;
  }
  return scrubbed;
}

/** True when every Microreact role ID is a declared key output for the workflow. */
export function microreactRolesAreDeclared(
  microreact: WorkflowKeyOutputMicroreactDelivery,
  keyOutputs: WorkflowKeyOutput[],
): boolean {
  const declared = new Set(keyOutputs.map((output) => output.KeyOutputId));
  const roles = [microreact.MetadataKeyOutputId, ...(microreact.TreeKeyOutputIds ?? [])].filter(Boolean);
  return roles.every((id) => declared.has(id!));
}
