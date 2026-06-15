import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RemoveFilesFromSequenceSetSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-sequence-set';
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
    if (!RemoveFilesFromSequenceSetSchema.safeParse(body).success) throw new InvalidRequestError();

    const { userId, laboratory } = await assertDataCollectionsAccess(event, body.LaboratoryId);
    sequenceSetService.assertBucketMatchesLab(laboratory, body.S3Bucket);

    await sequenceSetService.removeFilesFromSequenceSet(
      laboratory,
      userId,
      body.S3Bucket,
      body.SequenceSetId,
      body.Keys,
    );
    return buildResponse(200, JSON.stringify({ ok: true }), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
