import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateSequenceSetSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/create-sequence-set';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { assertDataCollectionsAccess } from '@BE/controllers/easy-genomics/data-collections/data-collections-auth';
import { DataCollectionService } from '@BE/services/easy-genomics/data-collection-service';
import { LaboratorySequenceSetService } from '@BE/services/easy-genomics/laboratory-sequence-set-service';

const sequenceSetService = new LaboratorySequenceSetService();
const dataCollectionService = new DataCollectionService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const parsed = CreateSequenceSetSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { userId, laboratory } = await assertDataCollectionsAccess(event, parsed.data.LaboratoryId);
    sequenceSetService.assertBucketMatchesLab(laboratory, parsed.data.S3Bucket);

    let keys = [...(parsed.data.Keys || [])];
    if (parsed.data.ExpandRegexFromListing && parsed.data.FilenameRegex) {
      const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
      const { contents } = await dataCollectionService.listTransactionInputs({
        bucket: parsed.data.S3Bucket,
        labPrefix,
        pageSize: 1000,
      });
      const regex = new RegExp(parsed.data.FilenameRegex);
      for (const obj of contents) {
        if (!obj.Key) continue;
        const base = obj.Key.split('/').pop() || obj.Key;
        if (regex.test(base)) keys.push(obj.Key);
      }
      keys = [...new Set(keys)];
    }

    if (parsed.data.ExistingSequenceSetId) {
      if (!keys.length) throw new InvalidRequestError('At least one file key is required');
      await sequenceSetService.addFilesToSequenceSet(
        laboratory,
        userId,
        parsed.data.S3Bucket,
        parsed.data.ExistingSequenceSetId,
        keys,
      );
      const set = await sequenceSetService.getSequenceSet(laboratory.LaboratoryId, parsed.data.ExistingSequenceSetId);
      return buildResponse(200, JSON.stringify(set), event);
    }

    if (!parsed.data.Name || !keys.length) throw new InvalidRequestError();

    const created = await sequenceSetService.createSequenceSet(laboratory, userId, parsed.data.S3Bucket, {
      name: parsed.data.Name,
      layout: parsed.data.Layout,
      filenameRegex: parsed.data.FilenameRegex,
      sampleIdPattern: parsed.data.SampleIdPattern,
      keys,
    });
    return buildResponse(200, JSON.stringify(created), event);
  } catch (err: any) {
    console.error(err);
    if (typeof err?.message === 'string' && err.message.startsWith('Unknown sequence set')) {
      return buildResponse(404, JSON.stringify({ message: err.message }), event);
    }
    return buildErrorResponse(err, event);
  }
};
