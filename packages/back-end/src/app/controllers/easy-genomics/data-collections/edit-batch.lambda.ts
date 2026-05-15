import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { AssignBatchSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/assign-batch';
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
    if (!AssignBatchSchema.safeParse(body).success) {
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

    const userId: string = event.requestContext.authorizer.claims['cognito:username'];
    taggingService.assertBucketMatchesLab(laboratory, body.S3Bucket);
    for (const key of body.Keys) {
      taggingService.assertKeyUnderLabPrefix(laboratory, key);
    }

    if (body.ClearBatch) {
      await taggingService.setBatchForFiles(laboratory, userId, body.S3Bucket, body.Keys, { type: 'clear' });
    } else if (body.BatchTagId) {
      await taggingService.setBatchForFiles(laboratory, userId, body.S3Bucket, body.Keys, {
        type: 'existing',
        batchTagId: body.BatchTagId,
      });
    } else if (body.NewBatchName) {
      await taggingService.setBatchForFiles(laboratory, userId, body.S3Bucket, body.Keys, {
        type: 'new',
        name: body.NewBatchName.trim(),
      });
    }

    return buildResponse(200, JSON.stringify({ ok: true }), event);
  } catch (err: any) {
    console.error(err);
    if (err instanceof InvalidRequestError || err instanceof UnauthorizedAccessError) {
      return buildErrorResponse(err, event);
    }
    if (typeof err?.message === 'string' && err.message.includes('not a batch')) {
      return buildResponse(400, JSON.stringify({ message: err.message }), event);
    }
    if (typeof err?.message === 'string' && err.message.startsWith('Unknown batch')) {
      return buildResponse(404, JSON.stringify({ message: err.message }), event);
    }
    if (err?.message === 'A tag with this name already exists') {
      return buildResponse(409, JSON.stringify({ message: err.message }), event);
    }
    return buildErrorResponse(err, event);
  }
};
