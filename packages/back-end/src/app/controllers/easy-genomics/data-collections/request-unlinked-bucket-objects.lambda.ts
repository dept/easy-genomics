import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestUnlinkedBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/request-unlinked-bucket-objects';
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
    const parsed = RequestUnlinkedBucketObjectsSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { laboratory } = await assertDataCollectionsAccess(event, parsed.data.LaboratoryId);
    const res = await sequenceSetService.listUnlinkedBucketObjects(laboratory, {
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
