import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestListSequenceSetTagsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/add-tags-to-sequence-sets';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertDataCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';

const taggingService = new LaboratoryDataTaggingService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const parsed = RequestListSequenceSetTagsSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    await assertDataCollectionsAccess(event, parsed.data.LaboratoryId);
    const res = await taggingService.listSequenceSetTagAssignments(
      parsed.data.LaboratoryId,
      parsed.data.SequenceSetIds,
    );
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
