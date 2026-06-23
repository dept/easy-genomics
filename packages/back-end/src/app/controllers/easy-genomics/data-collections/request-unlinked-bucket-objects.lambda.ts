import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestUnlinkedBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/request-unlinked-bucket-objects';
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
    const parsed = RequestUnlinkedBucketObjectsSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { laboratory } = await assertSequenceCollectionsAccess(event, parsed.data.LaboratoryId);
    const res = await sampleService.listUnlinkedBucketObjects(laboratory, {
      relativePrefix: parsed.data.RelativePrefix,
      maxTotalKeys: parsed.data.MaxTotalKeys,
      maxTransactionFolders: parsed.data.MaxTransactionFolders,
      pageSize: parsed.data.MaxKeys,
    });
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
