import { PassThrough, type Readable } from 'stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import archiver from 'archiver';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { S3Service } from '@BE/services/s3-service';
import {
  RUN_EXPORT_STATUS_EXPIRY_MS,
  destinationObjectKey,
  listExportableRunObjects,
  uniqueRunExportFolder,
  type RunExportJobMessage,
  type RunExportJobSource,
  type RunExportObject,
} from '@BE/utils/run-export-utils';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';

const s3Service = new S3Service();
const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;

type StoredRunExportJobStatus = {
  JobId: string;
  LaboratoryId: string;
  RunIds?: string[];
  Destination: RunExportJobMessage['Destination'];
  Status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  ArchiveS3Key?: string;
  DestBucket?: string;
  DestPrefix?: string;
  FilesCopied?: number;
  CreatedAt: string;
  ExpiresAt?: string;
  CompletedAt?: string;
  ErrorMessage?: string;
};

const writeStatus = async (input: {
  s3Bucket: string;
  statusKey: string;
  status: StoredRunExportJobStatus;
}): Promise<void> => {
  await s3Service.putObject({
    Bucket: input.s3Bucket,
    Key: input.statusKey,
    ContentType: 'application/json',
    Body: JSON.stringify(input.status),
  });
};

const uploadZipMultipart = async (job: RunExportJobMessage, zipStream: PassThrough): Promise<void> => {
  if (!job.ArchiveKey) {
    throw new Error('Missing archive key for ZIP export');
  }
  const s3Client: S3Client = s3Service.getClient();
  const uploader = new Upload({
    client: s3Client,
    params: {
      Bucket: job.StatusBucket,
      Key: job.ArchiveKey,
      Body: zipStream,
      ContentType: 'application/zip',
    },
    partSize: MULTIPART_PART_SIZE_BYTES,
    leavePartsOnError: false,
  });
  await uploader.done();
};

const zipSelectedOutputs = async (
  job: RunExportJobMessage,
  sources: Array<{ source: RunExportJobSource; objects: RunExportObject[] }>,
): Promise<void> => {
  const uploadStream = new PassThrough();
  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.pipe(uploadStream);
  let archiveError: Error | undefined;
  const uploadPromise = uploadZipMultipart(job, uploadStream);

  archive.on('warning', (warning: unknown) => {
    console.warn('Zip warning: ', warning);
  });
  archive.on('error', (err: unknown) => {
    archiveError = err instanceof Error ? err : new Error(String(err));
    uploadStream.destroy(archiveError);
  });

  for (const { source, objects } of sources) {
    const zipRootFolder = uniqueRunExportFolder({ RunId: source.RunId, RunName: source.RunName });
    for (const item of objects) {
      const relativeName = item.Key.startsWith(source.SourcePrefix)
        ? item.Key.slice(source.SourcePrefix.length)
        : item.Key;
      if (!relativeName) continue;

      const object = await s3Service.getObject({
        Bucket: source.SourceBucket,
        Key: item.Key,
      });
      if (!object.Body) continue;
      archive.append(object.Body as unknown as Readable, { name: `${zipRootFolder}/${relativeName}` });
    }
  }

  try {
    await archive.finalize();
    await uploadPromise;
    if (archiveError) {
      throw archiveError;
    }
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error(String(error));
    uploadStream.destroy(safeError);
    await uploadPromise.catch(() => {});
    throw safeError;
  }
};

const copySelectedOutputs = async (
  job: RunExportJobMessage,
  sources: Array<{ source: RunExportJobSource; objects: RunExportObject[] }>,
): Promise<number> => {
  if (!job.DestBucket || !job.DestPrefix) {
    throw new Error('Missing destination bucket or prefix for S3/LIMS export');
  }

  let copied = 0;
  for (const { source, objects } of sources) {
    const runFolder = uniqueRunExportFolder({ RunId: source.RunId, RunName: source.RunName });
    const destPrefix = `${job.DestPrefix}${runFolder}/`;
    for (const item of objects) {
      await s3Service.copyObjectBySize({
        sourceBucket: source.SourceBucket,
        sourceKey: item.Key,
        destBucket: job.DestBucket,
        destKey: destinationObjectKey(item.Key, source.SourcePrefix, destPrefix),
        sizeBytes: item.Size,
      });
      copied += 1;
    }
  }
  return copied;
};

/**
 * Worker that zips or server-side copies the selected runs' outputs.
 * Copy is the path for multi-GB result sets (no data through the browser).
 */
export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    for (const record of event.Records) {
      const job = parseSqsJsonBody<RunExportJobMessage>(record.body);
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

      await writeStatus({
        s3Bucket: job.StatusBucket,
        statusKey: job.StatusKey,
        status: processingStatus,
      });

      try {
        const sources: Array<{ source: RunExportJobSource; objects: RunExportObject[] }> = [];
        for (const source of job.Sources || []) {
          const objects = await listExportableRunObjects({
            s3: s3Service,
            bucket: source.SourceBucket,
            runPrefix: source.SourcePrefix,
          });
          if (objects.length > 0) {
            sources.push({ source, objects });
          }
        }
        if (sources.length === 0) {
          throw new Error('The selected runs do not contain exportable files');
        }

        let filesCopied: number | undefined;
        if (job.Destination === 'Download') {
          await zipSelectedOutputs(job, sources);
          filesCopied = sources.reduce((sum, item) => sum + item.objects.length, 0);
        } else {
          filesCopied = await copySelectedOutputs(job, sources);
        }

        await writeStatus({
          s3Bucket: job.StatusBucket,
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
        await writeStatus({
          s3Bucket: job.StatusBucket,
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

    return buildResponse(200, JSON.stringify({ Status: 'Success' }));
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err);
  }
};
