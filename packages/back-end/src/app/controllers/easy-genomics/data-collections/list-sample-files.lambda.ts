import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertSequenceCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { LaboratorySampleService } from '@BE/services/easy-genomics/laboratory-sample-service';

const sampleService = new LaboratorySampleService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId = event.queryStringParameters?.laboratoryId;
    const sampleId = event.queryStringParameters?.sampleId;
    if (!laboratoryId || !sampleId) throw new RequiredIdNotFoundError();

    const limit = Math.min(500, Math.max(1, Number(event.queryStringParameters?.limit || 100)));
    const cursor = event.queryStringParameters?.cursor;

    await assertSequenceCollectionsAccess(event, laboratoryId);
    const res = await sampleService.listSampleFiles(laboratoryId, sampleId, limit, cursor);
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
