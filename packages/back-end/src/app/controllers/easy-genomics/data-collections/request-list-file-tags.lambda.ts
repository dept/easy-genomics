import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { RequestListFileTagsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/request-list-file-tags';
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
  logSafeEvent(event);
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    if (!RequestListFileTagsSchema.safeParse(body).success) {
      throw new InvalidRequestError();
    }

    const laboratory = await laboratoryService.queryByLaboratoryId(body.LaboratoryId);
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

    taggingService.assertBucketMatchesLab(laboratory, body.S3Bucket);
    for (const key of body.Keys) {
      taggingService.assertKeyUnderLabPrefix(laboratory, key);
    }

    const files = await taggingService.listFileTags(body.LaboratoryId, body.S3Bucket, body.Keys);
    return buildResponse(200, JSON.stringify({ Files: files }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
