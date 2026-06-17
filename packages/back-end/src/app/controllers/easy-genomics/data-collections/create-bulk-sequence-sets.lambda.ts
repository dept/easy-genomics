import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { BulkCreateSequenceSetsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/bulk-create-sequence-sets';
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
    const parsed = BulkCreateSequenceSetsSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { userId, laboratory } = await assertDataCollectionsAccess(event, parsed.data.LaboratoryId);
    sequenceSetService.assertBucketMatchesLab(laboratory, parsed.data.S3Bucket);

    const res = await sequenceSetService.bulkCreateSequenceSets(laboratory, userId, parsed.data.S3Bucket, {
      importLabel: parsed.data.ImportLabel,
      sequenceSets: parsed.data.SequenceSets.map((s) => ({
        name: s.Name,
        layout: s.Layout,
        keys: s.Keys,
        tagIds: s.TagIds,
        filenameRegex: s.FilenameRegex,
        sampleIdPattern: s.SampleIdPattern,
      })),
      copyJobs: parsed.data.CopyJobs?.map((j) => ({
        sourceBucket: j.SourceBucket,
        sourceKey: j.SourceKey,
        destKey: j.DestKey,
      })),
    });
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
