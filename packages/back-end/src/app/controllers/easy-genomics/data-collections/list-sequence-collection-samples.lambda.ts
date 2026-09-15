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
    const sequenceCollectionId = event.queryStringParameters?.sequenceCollectionId;
    if (!laboratoryId || !sequenceCollectionId) throw new RequiredIdNotFoundError();

    await assertSequenceCollectionsAccess(event, laboratoryId);
    const setIds = await sampleService.listSequenceCollectionSampleIds(laboratoryId, sequenceCollectionId);
    return buildResponse(200, JSON.stringify({ SampleIds: setIds }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
