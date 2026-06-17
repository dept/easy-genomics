import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertDataCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';

const taggingService = new LaboratoryDataTaggingService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId = event.queryStringParameters?.laboratoryId;
    const tagId = event.queryStringParameters?.tagId;
    if (!laboratoryId || !tagId) throw new RequiredIdNotFoundError();

    await assertDataCollectionsAccess(event, laboratoryId);
    const limit = Math.min(Number(event.queryStringParameters?.limit || 100), 500);
    const cursor = event.queryStringParameters?.cursor;
    const res = await taggingService.listSequenceSetsByTag(laboratoryId, tagId, limit, cursor);
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
