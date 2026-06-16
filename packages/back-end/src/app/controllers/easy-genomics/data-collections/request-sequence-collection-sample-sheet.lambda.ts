import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { GenerateSequenceCollectionSampleSheetSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-sequence-collection';
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
    if (!GenerateSequenceCollectionSampleSheetSchema.safeParse(body).success) throw new InvalidRequestError();

    const { laboratory } = await assertSequenceCollectionsAccess(event, body.LaboratoryId);
    sampleService.assertBucketMatchesLab(laboratory, body.S3Bucket);

    const res = await sampleService.generateSequenceCollectionSampleSheet(
      laboratory,
      body.S3Bucket,
      body.SequenceCollectionId,
      {
        platform: body.Platform,
        transactionId: body.TransactionId,
        sampleSheetName: body.SampleSheetName,
        validateS3FilesExist: body.ValidateS3FilesExist,
      },
    );
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
