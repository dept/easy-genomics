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
    if (!laboratoryId) throw new RequiredIdNotFoundError();
    await assertDataCollectionsAccess(event, laboratoryId);
    const res = await sequenceSetService.listDataCollections(laboratoryId);
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
