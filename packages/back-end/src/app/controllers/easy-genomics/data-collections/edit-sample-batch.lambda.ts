import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { AssignSampleBatchSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/assign-sample-batch';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertSequenceCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';

const taggingService = new LaboratoryDataTaggingService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const parsed = AssignSampleBatchSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { userId, laboratory } = await assertSequenceCollectionsAccess(event, parsed.data.LaboratoryId);

    if (parsed.data.ClearBatch) {
      await taggingService.setBatchForSamples(laboratory, userId, parsed.data.SampleIds, { type: 'clear' });
    } else if (parsed.data.BatchTagId) {
      await taggingService.setBatchForSamples(laboratory, userId, parsed.data.SampleIds, {
        type: 'existing',
        batchTagId: parsed.data.BatchTagId,
      });
    } else if (parsed.data.NewBatchName) {
      await taggingService.setBatchForSamples(laboratory, userId, parsed.data.SampleIds, {
        type: 'new',
        name: parsed.data.NewBatchName.trim(),
      });
    }

    return buildResponse(200, JSON.stringify({ ok: true }), event);
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof InvalidRequestError) {
      return buildErrorResponse(err, event);
    }
    if (message.includes('not a batch')) {
      return buildResponse(400, JSON.stringify({ message }), event);
    }
    if (message.startsWith('Unknown batch') || message.startsWith('Unknown sample')) {
      return buildResponse(404, JSON.stringify({ message }), event);
    }
    if (message === 'A tag with this name already exists') {
      return buildResponse(409, JSON.stringify({ message }), event);
    }
    return buildErrorResponse(err, event);
  }
};
