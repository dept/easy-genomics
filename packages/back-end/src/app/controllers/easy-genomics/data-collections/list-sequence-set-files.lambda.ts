import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertDataCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { LaboratorySequenceSetService } from '@BE/services/easy-genomics/laboratory-sequence-set-service';

const sequenceSetService = new LaboratorySequenceSetService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId = event.queryStringParameters?.laboratoryId;
    const sequenceSetId = event.queryStringParameters?.sequenceSetId;
    if (!laboratoryId || !sequenceSetId) throw new RequiredIdNotFoundError();

    const limit = Math.min(500, Math.max(1, Number(event.queryStringParameters?.limit || 100)));
    const cursor = event.queryStringParameters?.cursor;

    await assertDataCollectionsAccess(event, laboratoryId);
    const res = await sequenceSetService.listSequenceSetFiles(laboratoryId, sequenceSetId, limit, cursor);
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
