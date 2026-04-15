import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateDataCollectionTagRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collection/data-collection';
import { CreateDataCollectionTagRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collection';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertCanAccessLaboratoryDataCollections } from './data-collection-auth';
import { DataCollectionService } from '@BE/services/easy-genomics/data-collection-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';

const laboratoryService = new LaboratoryService();
const dataCollectionService = new DataCollectionService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: CreateDataCollectionTagRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    if (!CreateDataCollectionTagRequestSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);
    assertCanAccessLaboratoryDataCollections(event, laboratory);

    const tag = await dataCollectionService.createTag(
      request.LaboratoryId,
      laboratory.OrganizationId,
      request.Name,
      request.Color,
    );

    return buildResponse(200, JSON.stringify({ Tag: tag }), event);
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
