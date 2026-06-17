import { UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();

export async function assertDataCollectionsAccess(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  laboratoryId: string,
): Promise<{ userId: string; laboratory: Laboratory }> {
  const laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
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
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'] || 'system';
  return { userId, laboratory };
}
