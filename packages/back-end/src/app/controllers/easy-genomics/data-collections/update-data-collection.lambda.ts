import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { UpdateDataCollectionSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-data-collection';
import { validateSampleSheetSchema } from '@easy-genomics/shared-lib/src/app/utils/data-collection-sample-sheet';
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
    const parsed = UpdateDataCollectionSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const schemaCheck = validateSampleSheetSchema(parsed.data.Columns);
    if (!schemaCheck.ok) {
      return buildResponse(400, JSON.stringify({ message: schemaCheck.message }), event);
    }

    const { userId, laboratory } = await assertDataCollectionsAccess(event, parsed.data.LaboratoryId);
    const updated = await sequenceSetService.updateDataCollection(laboratory, userId, parsed.data.DataCollectionId, {
      name: parsed.data.Name,
      columns: parsed.data.Columns,
      sequenceSetIds: parsed.data.SequenceSetIds,
    });
    return buildResponse(200, JSON.stringify(updated), event);
  } catch (err: any) {
    console.error(err);
    if (typeof err?.message === 'string' && err.message.startsWith('Unknown')) {
      return buildResponse(404, JSON.stringify({ message: err.message }), event);
    }
    return buildErrorResponse(err, event);
  }
};
