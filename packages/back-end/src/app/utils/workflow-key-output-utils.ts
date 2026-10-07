import { UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { normalizeS3Prefix, parseS3Uri, type ParsedS3Uri } from '@BE/utils/s3-uri-utils';

/**
 * File Manager root used when declaring key outputs. Matches the run detail
 * explorer: OutputS3Url (else InputS3Url), then one extra HealthOmics folder
 * named after ExternalRunId so patterns stay stable across runs.
 */
export function runKeyOutputsRoot(run: LaboratoryRun): ParsedS3Uri | null {
  const parsed = parseS3Uri(run.OutputS3Url || run.InputS3Url);
  if (!parsed?.bucket) return null;

  let prefix = parsed.prefix ? normalizeS3Prefix(parsed.prefix) : '';
  if (run.Platform === 'AWS HealthOmics' && run.ExternalRunId) {
    const externalFolder = `${run.ExternalRunId}/`;
    if (!prefix.endsWith(externalFolder)) {
      prefix = `${prefix}${externalFolder}`;
    }
  }
  if (!prefix) return null;
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
