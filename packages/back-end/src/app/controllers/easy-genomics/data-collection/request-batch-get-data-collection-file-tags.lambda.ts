import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { BatchGetDataCollectionFileTagsRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collection/data-collection';
import { BatchGetDataCollectionFileTagsRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collection';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertCanAccessLaboratoryDataCollections, assertS3KeyBelongsToLaboratory } from './data-collection-auth';
import { DataCollectionService } from '@BE/services/easy-genomics/data-collection-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';

const laboratoryService = new LaboratoryService();
const dataCollectionService = new DataCollectionService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: BatchGetDataCollectionFileTagsRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    if (!BatchGetDataCollectionFileTagsRequestSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);
    assertCanAccessLaboratoryDataCollections(event, laboratory);

    for (const key of request.S3Keys) {
      assertS3KeyBelongsToLaboratory(laboratory, key);
    }

    const assignments = await dataCollectionService.batchGetFileTags(request.LaboratoryId, request.S3Keys);

    return buildResponse(200, JSON.stringify({ Assignments: assignments }), event);
  } catch (error: unknown) {
    console.error('ERROR: ' + JSON.stringify(error));
    if (error instanceof InvalidRequestError) {
      return buildErrorResponse(error);
    }
    if (error instanceof UnauthorizedAccessError) {
      return buildErrorResponse(error);
    }
    return buildErrorResponse(new Error('Internal server error'));
  }
};
