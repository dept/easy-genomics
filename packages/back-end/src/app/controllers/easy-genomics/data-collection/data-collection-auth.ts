import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

export function assertCanAccessLaboratoryDataCollections(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  laboratory: Laboratory,
): void {
  if (
    !(
      validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
      validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
      validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
    )
  ) {
    throw new UnauthorizedAccessError();
  }
}

export function assertS3KeyBelongsToLaboratory(laboratory: Laboratory, s3Key: string): void {
  const prefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
  if (!s3Key.startsWith(prefix)) {
    throw new InvalidRequestError();
  }
}
