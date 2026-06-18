import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateSampleSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-sample';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertSequenceCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { LaboratorySampleService } from '@BE/services/easy-genomics/laboratory-sample-service';

const sampleService = new LaboratorySampleService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const parsed = CreateSampleSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { userId, laboratory } = await assertSequenceCollectionsAccess(event, parsed.data.LaboratoryId);

    const result = await sampleService.createOrExtendSample(laboratory, userId, parsed.data.S3Bucket, {
      keys: [...(parsed.data.Keys || [])],
      layout: parsed.data.Layout,
      existingSampleId: parsed.data.ExistingSampleId,
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
