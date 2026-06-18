import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { BulkCreateSamplesSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/bulk-create-samples';
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
    const parsed = BulkCreateSamplesSchema.safeParse(body);
    if (!parsed.success) throw new InvalidRequestError();

    const { userId, laboratory } = await assertSequenceCollectionsAccess(event, parsed.data.LaboratoryId);
    sampleService.assertBucketMatchesLab(laboratory, parsed.data.S3Bucket);

    const res = await sampleService.bulkCreateSamples(laboratory, userId, parsed.data.S3Bucket, {
      importLabel: parsed.data.ImportLabel,
      samples: parsed.data.Samples.map((s) => ({
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
      ...(parsed.data.NewBatchName ? { newBatchName: parsed.data.NewBatchName } : {}),
      ...(parsed.data.BatchTagId ? { batchTagId: parsed.data.BatchTagId } : {}),
    });
    return buildResponse(200, JSON.stringify(res), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
