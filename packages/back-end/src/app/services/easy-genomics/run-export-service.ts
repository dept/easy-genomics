import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RequestRunExportJob,
  RunExportJobResponse,
  RunExportJobStatusResponse,
  RunExportPreviewResponse,
  RunExportPreviewRun,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run/request-run-export-job';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import { SqsService } from '@BE/services/sqs-service';
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
  destinationObjectKey,
  labScopedExportPrefix,
  listExportableRunObjects,
  requireLaboratoryS3Bucket,
  resolveRunOutputLocation,
  safeRunFolderName,
  uniqueRunExportFolder,
  uniqueRunIds,
  type RunExportJobMessage,
  type RunExportJobSource,
  type RunExportObject,
  type StoredRunExportJobStatus,
} from '@BE/utils/run-export-utils';
import { s3BodyToString } from '@BE/utils/s3-object-body';
import { zipS3ObjectsToArchive } from '@BE/utils/s3-zip-archive';

export type CollectedRunExport = {
  run: LaboratoryRun;
  source: RunExportJobSource;
  objects: RunExportObject[];
  bytes: number;
};

/**
 * Preview, enqueue, poll, and process multi-run result exports.
 * Handlers stay thin; the worker re-resolves runs and re-checks grants.
 */
export class RunExportService {
  constructor(
    private readonly laboratoryService = new LaboratoryService(),
    private readonly laboratoryRunService = new LaboratoryRunService(),
    private readonly s3 = new S3Service(),
    private readonly sqs = new SqsService(),
    private readonly s3Access = new LaboratoryS3AccessService(),
    private readonly tagging = new LaboratoryDataTaggingService(),
  ) {}

  async preview(laboratory: Laboratory, runIds: string[]): Promise<RunExportPreviewResponse> {
    const collected = await this.collectRuns(laboratory, runIds);
    const runPreviews: RunExportPreviewRun[] = collected.map((item) => ({
      RunId: item.run.RunId,
      RunName: item.run.RunName,
      SourceS3Uri: resolveRunOutputLocation(item.run).uri,
      FileCount: item.objects.length,
      TotalBytes: item.bytes,
    }));
    const fileCount = collected.reduce((sum, item) => sum + item.objects.length, 0);
    const totalBytes = collected.reduce((sum, item) => sum + item.bytes, 0);

    return {
      RunCount: runPreviews.length,
      FileCount: fileCount,
      TotalBytes: totalBytes,
      CanDownloadAsZip: fileCount > 0 && totalBytes <= RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES,
      ZipSizeLimitBytes: RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES,
      Runs: runPreviews,
    };
  }

  async startJob(laboratory: Laboratory, request: RequestRunExportJob): Promise<RunExportJobResponse> {
    const collected = await this.collectRuns(laboratory, request.RunIds);
    const fileCount = collected.reduce((sum, item) => sum + item.objects.length, 0);
    const totalBytes = collected.reduce((sum, item) => sum + item.bytes, 0);
    if (fileCount === 0) {
      throw new InvalidRequestError(RUN_OUTPUT_EMPTY_MESSAGE);
    }
    if (request.Destination === 'Download' && totalBytes > RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES) {
      throw new InvalidRequestError(ZIP_TOO_LARGE_MESSAGE);
    }

    const statusBucket = requireLaboratoryS3Bucket(laboratory);
    await assertLaboratoryHasS3BucketAccess(laboratory, statusBucket, this.s3Access);

    const destination = await this.resolveCopyDestination(laboratory, request, collected);
    const jobId = uuidv4();
    const laboratoryOwnedPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const statusKey = `${laboratoryOwnedPrefix}${RUN_EXPORT_JOBS_PREFIX}/${jobId}.json`;
    const archiveKey =
      request.Destination === 'Download'
        ? `${laboratoryOwnedPrefix}${RUN_EXPORT_ARCHIVES_PREFIX}/${jobId}.zip`
        : undefined;

    this.tagging.assertKeyUnderLabPrefix(laboratory, statusKey);
    if (archiveKey) {
      this.tagging.assertKeyUnderLabPrefix(laboratory, archiveKey);
    }

    const sources = collected.map((item) => item.source);
    await this.writeStatus({
      s3Bucket: statusBucket,
      statusKey,
      status: {
        JobId: jobId,
        LaboratoryId: laboratory.LaboratoryId,
        RunIds: sources.map((source) => source.RunId),
        Destination: request.Destination,
        Status: 'PENDING',
        ArchiveS3Key: archiveKey,
        DestBucket: destination.destBucket,
        DestPrefix: destination.destPrefix,
        CreatedAt: new Date().toISOString(),
        ExpiresAt: new Date(Date.now() + RUN_EXPORT_STATUS_EXPIRY_MS).toISOString(),
      },
    });

    const queueUrl = process.env.SQS_RUN_EXPORT_QUEUE_URL || '';
    if (!queueUrl) {
      throw new Error('Missing SQS_RUN_EXPORT_QUEUE_URL environment variable');
    }

    const message: RunExportJobMessage = {
      JobId: jobId,
      LaboratoryId: laboratory.LaboratoryId,
      OrganizationId: laboratory.OrganizationId,
      Destination: request.Destination,
      Sources: sources,
      StatusBucket: statusBucket,
      StatusKey: statusKey,
      ArchiveKey: archiveKey,
      DestBucket: destination.destBucket,
      DestPrefix: destination.destPrefix,
    };

    await this.sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageGroupId: laboratory.LaboratoryId,
      MessageDeduplicationId: `${jobId}-${Date.now()}`,
      MessageBody: JSON.stringify(message),
    });

    return {
      JobId: jobId,
      Status: 'PENDING',
      Destination: request.Destination,
    };
  }

  async getJobStatus(laboratory: Laboratory, jobId: string): Promise<RunExportJobStatusResponse> {
    const s3Bucket = requireLaboratoryS3Bucket(laboratory);
    await assertLaboratoryHasS3BucketAccess(laboratory, s3Bucket, this.s3Access);

    const statusKey = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/${RUN_EXPORT_JOBS_PREFIX}/${jobId}.json`;
    this.tagging.assertKeyUnderLabPrefix(laboratory, statusKey);

    const statusObject = await this.s3.getObject({ Bucket: s3Bucket, Key: statusKey });
    const statusJson = await s3BodyToString(statusObject.Body);
    if (!statusJson) {
      throw new InvalidRequestError('Export job status is unavailable');
    }
    const parsedStatus = JSON.parse(statusJson) as StoredRunExportJobStatus;

    if (parsedStatus.ExpiresAt && new Date(parsedStatus.ExpiresAt).getTime() <= Date.now()) {
      if (parsedStatus.ArchiveS3Key) {
        this.tagging.assertKeyUnderLabPrefix(laboratory, parsedStatus.ArchiveS3Key);
        await this.s3.deleteObject({ Bucket: s3Bucket, Key: parsedStatus.ArchiveS3Key });
      }
      await this.s3.deleteObject({ Bucket: s3Bucket, Key: statusKey });
      throw new InvalidRequestError('This export has expired. Please request it again.');
    }

    const response: RunExportJobStatusResponse = {
      JobId: parsedStatus.JobId,
      Status: parsedStatus.Status,
      Destination: parsedStatus.Destination,
      FilesCopied: parsedStatus.FilesCopied,
      ErrorMessage: parsedStatus.ErrorMessage,
    };

    if (parsedStatus.Status === 'COMPLETED' && parsedStatus.Destination === 'Download' && parsedStatus.ArchiveS3Key) {
      this.tagging.assertKeyUnderLabPrefix(laboratory, parsedStatus.ArchiveS3Key);
      const runIds = parsedStatus.RunIds?.length ? parsedStatus.RunIds : parsedStatus.RunId ? [parsedStatus.RunId] : [];
      const folderName =
        runIds.length === 1
          ? safeRunFolderName(parsedStatus.RunName, runIds[0])
          : `bundle-${Math.max(runIds.length, 1)}-runs`;
      response.DownloadUrl = await this.s3.getPreSignedDownloadUrl({
        Bucket: s3Bucket,
        Key: parsedStatus.ArchiveS3Key,
        ResponseContentDisposition: `attachment; filename="${folderName}-results.zip"`,
      });
    }

    if (
      parsedStatus.Status === 'COMPLETED' &&
      parsedStatus.Destination &&
      parsedStatus.Destination !== 'Download' &&
      parsedStatus.DestBucket &&
      parsedStatus.DestPrefix
    ) {
      this.tagging.assertKeyUnderLabPrefix(laboratory, parsedStatus.DestPrefix);
      response.DestinationS3Uri = `s3://${parsedStatus.DestBucket}/${parsedStatus.DestPrefix}`;
    }

    return response;
  }

  async processSqsRecord(job: RunExportJobMessage): Promise<void> {
    const laboratory = await this.laboratoryService.queryByLaboratoryId(job.LaboratoryId);
    if (laboratory.OrganizationId !== job.OrganizationId) {
      throw new UnauthorizedAccessError();
    }

    const statusBucket = requireLaboratoryS3Bucket(laboratory);
    if (job.StatusBucket !== statusBucket) {
      throw new InvalidRequestError('Export job status bucket does not match the laboratory bucket');
    }
    this.tagging.assertKeyUnderLabPrefix(laboratory, job.StatusKey);
    if (job.ArchiveKey) {
      this.tagging.assertKeyUnderLabPrefix(laboratory, job.ArchiveKey);
    }

    const createdAt = new Date().toISOString();
    const processingStatus: StoredRunExportJobStatus = {
      JobId: job.JobId,
      LaboratoryId: job.LaboratoryId,
      RunIds: (job.Sources || []).map((source) => source.RunId),
      Destination: job.Destination,
      Status: 'PROCESSING',
      ArchiveS3Key: job.ArchiveKey,
      DestBucket: job.DestBucket,
      DestPrefix: job.DestPrefix,
      CreatedAt: createdAt,
    };

    await this.writeStatus({ s3Bucket: statusBucket, statusKey: job.StatusKey, status: processingStatus });

    try {
      const collected = await this.collectRuns(
        laboratory,
        (job.Sources || []).map((source) => source.RunId),
      );
      if (collected.reduce((sum, item) => sum + item.objects.length, 0) === 0) {
        throw new InvalidRequestError(RUN_OUTPUT_EMPTY_MESSAGE);
      }
      if (job.Destination !== 'Download') {
        if (!job.DestBucket || !job.DestPrefix) {
          throw new InvalidRequestError('Missing destination bucket or prefix for S3/LIMS export');
        }
        await assertLaboratoryHasS3BucketAccess(laboratory, job.DestBucket, this.s3Access);
        this.tagging.assertKeyUnderLabPrefix(laboratory, job.DestPrefix);
        for (const item of collected) {
          assertDestinationDoesNotOverlapSource({
            sourceBucket: item.source.SourceBucket,
            sourcePrefix: item.source.SourcePrefix,
            destBucket: job.DestBucket,
            destPrefix: job.DestPrefix,
          });
        }
      }

      const filesCopied =
        job.Destination === 'Download' ? await this.zipOutputs(job, collected) : await this.copyOutputs(job, collected);

      await this.writeStatus({
        s3Bucket: statusBucket,
        statusKey: job.StatusKey,
        status: {
          ...processingStatus,
          Status: 'COMPLETED',
          FilesCopied: filesCopied,
          CompletedAt: new Date().toISOString(),
          ExpiresAt: new Date(Date.now() + RUN_EXPORT_STATUS_EXPIRY_MS).toISOString(),
        },
      });
    } catch (error: any) {
      await this.writeStatus({
        s3Bucket: statusBucket,
        statusKey: job.StatusKey,
        status: {
          ...processingStatus,
          Status: 'FAILED',
          CompletedAt: new Date().toISOString(),
          ErrorMessage: error?.message || 'Unable to export run results',
          ExpiresAt: new Date(Date.now() + RUN_EXPORT_STATUS_EXPIRY_MS).toISOString(),
        },
      });
    }
  }

  private async collectRuns(laboratory: Laboratory, runIds: string[]): Promise<CollectedRunExport[]> {
    const collected: CollectedRunExport[] = [];
    let fileCount = 0;

    for (const runId of uniqueRunIds(runIds)) {
      const run = await this.laboratoryRunService.queryByRunId(runId);
      if (run.LaboratoryId !== laboratory.LaboratoryId) {
        throw new UnauthorizedAccessError();
      }
      assertCompletedRun(run);

      const sourceLocation = resolveRunOutputLocation(run);
      await assertLaboratoryHasS3BucketAccess(laboratory, sourceLocation.bucket, this.s3Access);
      const objects = await listExportableRunObjects({
        s3: this.s3,
        bucket: sourceLocation.bucket,
        runPrefix: sourceLocation.prefix,
      });
      fileCount += objects.length;
      if (fileCount > RUN_EXPORT_MAX_EXPANDED_OBJECTS) {
        throw new InvalidRequestError(RUN_EXPORT_TOO_MANY_OBJECTS_MESSAGE);
      }

      collected.push({
        run,
        source: {
          RunId: run.RunId,
          RunName: run.RunName,
          SourceBucket: sourceLocation.bucket,
          SourcePrefix: sourceLocation.prefix,
        },
        objects,
        bytes: objects.reduce((sum, object) => sum + object.Size, 0),
      });
    }

    return collected;
  }

  private async resolveCopyDestination(
    laboratory: Laboratory,
    request: RequestRunExportJob,
    collected: CollectedRunExport[],
  ): Promise<{ destBucket?: string; destPrefix?: string }> {
    if (request.Destination === 'Download') {
      return {};
    }

    const destBucket = request.DestinationBucket!;
    await assertLaboratoryHasS3BucketAccess(laboratory, destBucket, this.s3Access);
    const destPrefix = labScopedExportPrefix(
      laboratory,
      request.DestinationPrefix,
      collected.length === 1
        ? defaultExportPrefix({ laboratory, run: collected[0].run, destination: request.Destination })
        : defaultBundleExportPrefix({
            laboratory,
            destination: request.Destination,
            runCount: collected.length,
          }),
    );
    this.tagging.assertKeyUnderLabPrefix(laboratory, destPrefix);
    for (const item of collected) {
      assertDestinationDoesNotOverlapSource({
        sourceBucket: item.source.SourceBucket,
        sourcePrefix: item.source.SourcePrefix,
        destBucket,
        destPrefix,
      });
    }
    return { destBucket, destPrefix };
  }

  private async zipOutputs(job: RunExportJobMessage, collected: CollectedRunExport[]): Promise<number> {
    if (!job.ArchiveKey) {
      throw new Error('Missing archive key for ZIP export');
    }
    const entries = collected.flatMap((item) => {
      const zipRootFolder = uniqueRunExportFolder({ RunId: item.source.RunId, RunName: item.source.RunName });
      return item.objects
        .map((object) => {
          const relativeName = object.Key.startsWith(item.source.SourcePrefix)
            ? object.Key.slice(item.source.SourcePrefix.length)
            : object.Key;
          if (!relativeName) return undefined;
          return {
            sourceBucket: item.source.SourceBucket,
            sourceKey: object.Key,
            archivePath: `${zipRootFolder}/${relativeName}`,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry);
    });
    if (entries.length === 0) {
      throw new Error('The selected runs do not contain exportable files');
    }
    await zipS3ObjectsToArchive({
      s3: this.s3,
      destinationBucket: job.StatusBucket,
      destinationKey: job.ArchiveKey,
      entries,
    });
    return entries.length;
  }

  private async copyOutputs(job: RunExportJobMessage, collected: CollectedRunExport[]): Promise<number> {
    let copied = 0;
    for (const item of collected) {
      const runFolder = uniqueRunExportFolder({ RunId: item.source.RunId, RunName: item.source.RunName });
      const destPrefix = `${job.DestPrefix}${runFolder}/`;
      for (const object of item.objects) {
        await this.s3.copyObjectBySize({
          sourceBucket: item.source.SourceBucket,
          sourceKey: object.Key,
          destBucket: job.DestBucket!,
          destKey: destinationObjectKey(object.Key, item.source.SourcePrefix, destPrefix),
          sizeBytes: object.Size,
        });
        copied += 1;
      }
    }
    return copied;
  }

  private async writeStatus(input: {
    s3Bucket: string;
    statusKey: string;
    status: StoredRunExportJobStatus;
  }): Promise<void> {
    await this.s3.putObject({
      Bucket: input.s3Bucket,
      Key: input.statusKey,
      ContentType: 'application/json',
      Body: JSON.stringify(input.status),
    });
  }
}
