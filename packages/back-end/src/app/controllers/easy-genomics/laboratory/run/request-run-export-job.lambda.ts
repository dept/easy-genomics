import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RequestRunExportJob,
  RequestRunExportJobSchema,
  RunExportJobResponse,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run/request-run-export-job';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import { SqsService } from '@BE/services/sqs-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '@BE/utils/laboratory-s3-access-utils';
import {
  RUN_EXPORT_ARCHIVES_PREFIX,
  RUN_EXPORT_JOBS_PREFIX,
  RUN_EXPORT_MAX_EXPANDED_OBJECTS,
  RUN_EXPORT_STATUS_EXPIRY_MS,
  RUN_EXPORT_TOO_MANY_OBJECTS_MESSAGE,
  RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES,
  RUN_OUTPUT_EMPTY_MESSAGE,
  ZIP_TOO_LARGE_MESSAGE,
  assertCompletedRun,
  assertDestinationDoesNotOverlapSource,
  defaultBundleExportPrefix,
  defaultExportPrefix,
  listExportableRunObjects,
  resolveRunOutputLocation,
  sanitizeExportPrefix,
  uniqueRunIds,
  type RunExportJobMessage,
  type RunExportJobSource,
} from '@BE/utils/run-export-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const s3Service = new S3Service();
const sqsService = new SqsService();
const s3AccessService = new LaboratoryS3AccessService();

/**
 * Starts an async job that zips or copies the outputs of one or more completed
 * runs. ZIP is capped at 5GB; larger selections must go to S3 / LIMS.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: RequestRunExportJob = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    const parsed = RequestRunExportJobSchema.safeParse(request);
    if (!parsed.success) {
      throw new InvalidRequestError();
    }

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(parsed.data.LaboratoryId);
    if (
      !(
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const sources: RunExportJobSource[] = [];
    const runs: LaboratoryRun[] = [];
    let fileCount = 0;
    let totalBytes = 0;

    for (const runId of uniqueRunIds(parsed.data.RunIds)) {
      const run: LaboratoryRun = await laboratoryRunService.queryByRunId(runId);
      if (run.LaboratoryId !== laboratory.LaboratoryId) {
        throw new UnauthorizedAccessError();
      }
      assertCompletedRun(run);

      const source = resolveRunOutputLocation(run);
      await assertLaboratoryHasS3BucketAccess(laboratory, source.bucket, s3AccessService);
      const exportable = await listExportableRunObjects({
        s3: s3Service,
        bucket: source.bucket,
        runPrefix: source.prefix,
      });
      fileCount += exportable.length;
      totalBytes += exportable.reduce((sum, object) => sum + object.Size, 0);
      if (fileCount > RUN_EXPORT_MAX_EXPANDED_OBJECTS) {
        throw new InvalidRequestError(RUN_EXPORT_TOO_MANY_OBJECTS_MESSAGE);
      }

      runs.push(run);
      sources.push({
        RunId: run.RunId,
        RunName: run.RunName,
        SourceBucket: source.bucket,
        SourcePrefix: source.prefix,
      });
    }

    if (fileCount === 0) {
      throw new InvalidRequestError(RUN_OUTPUT_EMPTY_MESSAGE);
    }
    if (parsed.data.Destination === 'Download' && totalBytes > RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES) {
      throw new InvalidRequestError(ZIP_TOO_LARGE_MESSAGE);
    }

    const statusBucket = laboratory.S3Bucket || sources[0]?.SourceBucket;
    if (!statusBucket) {
      throw new InvalidRequestError('Laboratory does not have an S3 bucket configured');
    }
    await assertLaboratoryHasS3BucketAccess(laboratory, statusBucket, s3AccessService);

    let destBucket: string | undefined;
    let destPrefix: string | undefined;
    if (parsed.data.Destination !== 'Download') {
      destBucket = parsed.data.DestinationBucket!;
      await assertLaboratoryHasS3BucketAccess(laboratory, destBucket, s3AccessService);
      destPrefix = parsed.data.DestinationPrefix
        ? sanitizeExportPrefix(parsed.data.DestinationPrefix)
        : runs.length === 1
          ? defaultExportPrefix({ laboratory, run: runs[0], destination: parsed.data.Destination })
          : defaultBundleExportPrefix({
              laboratory,
              destination: parsed.data.Destination,
              runCount: runs.length,
            });
      for (const source of sources) {
        assertDestinationDoesNotOverlapSource({
          sourceBucket: source.SourceBucket,
          sourcePrefix: source.SourcePrefix,
          destBucket,
          destPrefix,
        });
      }
    }

    const jobId = uuidv4();
    const laboratoryOwnedPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const statusKey = `${laboratoryOwnedPrefix}${RUN_EXPORT_JOBS_PREFIX}/${jobId}.json`;
    const archiveKey =
      parsed.data.Destination === 'Download'
        ? `${laboratoryOwnedPrefix}${RUN_EXPORT_ARCHIVES_PREFIX}/${jobId}.zip`
        : undefined;

    await s3Service.putObject({
      Bucket: statusBucket,
      Key: statusKey,
      ContentType: 'application/json',
      Body: JSON.stringify({
        JobId: jobId,
        LaboratoryId: laboratory.LaboratoryId,
        RunIds: sources.map((source) => source.RunId),
        Destination: parsed.data.Destination,
        Status: 'PENDING',
        ArchiveS3Key: archiveKey,
        DestBucket: destBucket,
        DestPrefix: destPrefix,
        CreatedAt: new Date().toISOString(),
        ExpiresAt: new Date(Date.now() + RUN_EXPORT_STATUS_EXPIRY_MS).toISOString(),
      }),
    });

    const queueUrl = process.env.SQS_RUN_EXPORT_QUEUE_URL || '';
    if (!queueUrl) {
      throw new Error('Missing SQS_RUN_EXPORT_QUEUE_URL environment variable');
    }

    const message: RunExportJobMessage = {
      JobId: jobId,
      LaboratoryId: laboratory.LaboratoryId,
      OrganizationId: laboratory.OrganizationId,
      Destination: parsed.data.Destination,
      Sources: sources,
      StatusBucket: statusBucket,
      StatusKey: statusKey,
      ArchiveKey: archiveKey,
      DestBucket: destBucket,
      DestPrefix: destPrefix,
    };

    await sqsService.sendMessage({
      QueueUrl: queueUrl,
      MessageGroupId: laboratory.LaboratoryId,
      MessageDeduplicationId: `${jobId}-${Date.now()}`,
      MessageBody: JSON.stringify(message),
    });

    const response: RunExportJobResponse = {
      JobId: jobId,
      Status: 'PENDING',
      Destination: parsed.data.Destination,
    };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
