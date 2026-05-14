import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const taggingService = new LaboratoryDataTaggingService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId = event.queryStringParameters?.laboratoryId;
    if (!laboratoryId) throw new RequiredIdNotFoundError();

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

    // Lazy-create the laboratory's singleton permanent tag so the UI can always render the
    // "Mark Permanent" affordance without a separate provisioning round trip. Idempotent and
    // safe under concurrent first reads (deterministic id + conditional PutItem).
    const userId = event.requestContext.authorizer?.claims?.['cognito:username'] || 'system';
    await taggingService.ensurePermanentTag(laboratory, userId);

    const res = await taggingService.listTags(laboratoryId);
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
