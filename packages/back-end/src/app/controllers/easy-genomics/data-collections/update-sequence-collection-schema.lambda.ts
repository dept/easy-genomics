import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { UpdateSequenceCollectionSchemaSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-sequence-collection';
import { validateSampleSheetSchema } from '@easy-genomics/shared-lib/src/app/utils/data-collection-sample-sheet';
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
    if (!UpdateSequenceCollectionSchemaSchema.safeParse(body).success) throw new InvalidRequestError();

    const schemaCheck = validateSampleSheetSchema(body.Columns);
    if (!schemaCheck.ok) {
      return buildResponse(400, JSON.stringify({ message: schemaCheck.message }), event);
    }

    const { userId, laboratory } = await assertSequenceCollectionsAccess(event, body.LaboratoryId);
    const updated = await sampleService.updateSequenceCollectionSchema(
      laboratory,
      userId,
      body.SequenceCollectionId,
      body.Columns,
    );
    return buildResponse(200, JSON.stringify(updated), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
