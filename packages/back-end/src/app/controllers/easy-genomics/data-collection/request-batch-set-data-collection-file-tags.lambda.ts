import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  DATA_COLLECTION_MAX_TAGS_PER_FILE,
  BatchSetDataCollectionFileTagsRequestSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collection/data-collection';
import { BatchSetDataCollectionFileTagsRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collection';
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
    const request: BatchSetDataCollectionFileTagsRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    if (!BatchSetDataCollectionFileTagsRequestSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);
    assertCanAccessLaboratoryDataCollections(event, laboratory);

    const definedTags = await dataCollectionService.listTags(request.LaboratoryId);
    const validTagIds = new Set(definedTags.map((t) => t.TagId));

    for (const item of request.Items) {
      assertS3KeyBelongsToLaboratory(laboratory, item.S3Key);
      if (item.TagIds.length > DATA_COLLECTION_MAX_TAGS_PER_FILE) {
        throw new InvalidRequestError();
      }
      for (const tid of item.TagIds) {
        if (!validTagIds.has(tid)) {
          throw new InvalidRequestError();
        }
      }
    }

    const updated = await dataCollectionService.batchSetFileTags(
      request.LaboratoryId,
      laboratory.OrganizationId,
      request.Items.map((i) => ({ S3Key: i.S3Key, TagIds: i.TagIds })),
    );

    return buildResponse(200, JSON.stringify({ Updated: updated }), event);
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
