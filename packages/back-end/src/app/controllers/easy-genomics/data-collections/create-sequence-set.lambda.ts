import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateSequenceSetSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-sequence-set';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertDataCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { LaboratorySequenceSetService } from '@BE/services/easy-genomics/laboratory-sequence-set-service';

const sequenceSetService = new LaboratorySequenceSetService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const parsed = CreateSequenceSetSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { userId, laboratory } = await assertDataCollectionsAccess(event, parsed.data.LaboratoryId);

    const result = await sequenceSetService.createOrExtendSequenceSet(laboratory, userId, parsed.data.S3Bucket, {
      keys: [...(parsed.data.Keys || [])],
      layout: parsed.data.Layout,
      existingSequenceSetId: parsed.data.ExistingSequenceSetId,
      name: parsed.data.Name,
      filenameRegex: parsed.data.FilenameRegex,
      sampleIdPattern: parsed.data.SampleIdPattern,
      expandRegexFromListing: parsed.data.ExpandRegexFromListing,
    });
    return buildResponse(200, JSON.stringify(result), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
