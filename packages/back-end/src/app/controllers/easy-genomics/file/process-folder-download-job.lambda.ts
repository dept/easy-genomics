import { PassThrough, type Readable } from 'stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import archiver from 'archiver';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { S3Service } from '@BE/services/s3-service';

const s3Service = new S3Service();
const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
const DOWNLOAD_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

type FolderDownloadJobMessage = {
  JobId: string;
  LaboratoryId: string;
  OrganizationId: string;
  S3Bucket: string;
  RequestedPrefix: string;
  ArchiveKey: string;
  StatusKey: string;
};

type StoredFolderDownloadJobStatus = {
  JobId: string;
  LaboratoryId: string;
  Status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  RequestedPrefix: string;
  ArchiveS3Key: string;
  CreatedAt: string;
  ExpiresAt?: string;
  CompletedAt?: string;
  ErrorMessage?: string;
};

const normalizePrefix = (prefix: string): string => (prefix.endsWith('/') ? prefix : `${prefix}/`);
const getZipRootFolderName = (prefix: string): string => {
  const trimmedPrefix = prefix.replace(/\/+$/, '');
  const lastSegment = trimmedPrefix.split('/').filter(Boolean).pop() || 'folder-download';
  return lastSegment.replace(/[^\w.-]/g, '_');
};

const writeStatus = async (input: {
  s3Bucket: string;
  statusKey: string;
  status: StoredFolderDownloadJobStatus;
}): Promise<void> => {
  await s3Service.putObject({
    Bucket: input.s3Bucket,
    Key: input.statusKey,
    ContentType: 'application/json',
    Body: JSON.stringify(input.status),
  });
};

const parseSnsWrappedMessage = (body: string): FolderDownloadJobMessage => {
  const parsedBody = JSON.parse(body);
  const messageBody = parsedBody?.Message ? parsedBody.Message : body;
  return JSON.parse(messageBody) as FolderDownloadJobMessage;
};

const uploadZipMultipart = async (job: FolderDownloadJobMessage, zipStream: PassThrough): Promise<void> => {
  const s3Client: S3Client = s3Service.getClient();

  const uploader = new Upload({
    client: s3Client,
    params: {
      Bucket: job.S3Bucket,
      Key: job.ArchiveKey,
      Body: zipStream,
      ContentType: 'application/zip',
    },
    partSize: MULTIPART_PART_SIZE_BYTES,
    leavePartsOnError: false,
  });

  await uploader.done();
};

const zipS3Prefix = async (job: FolderDownloadJobMessage): Promise<void> => {
  const normalizedPrefix = normalizePrefix(job.RequestedPrefix);
  const zipRootFolder = getZipRootFolderName(normalizedPrefix);

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

  let continuationToken: string | undefined = undefined;
  let isTruncated = true;
  let filesAdded = 0;

  while (isTruncated) {
    const page = await s3Service.listBucketObjectsV2({
      Bucket: job.S3Bucket,
      Prefix: normalizedPrefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });

    for (const item of page.Contents || []) {
      const key = item.Key || '';
      if (!key || key.endsWith('/')) continue;

      const relativeName = key.startsWith(normalizedPrefix) ? key.slice(normalizedPrefix.length) : key;
      if (!relativeName) continue;

      const object = await s3Service.getObject({
        Bucket: job.S3Bucket,
        Key: key,
      });

      if (!object.Body) continue;
      archive.append(object.Body as unknown as Readable, { name: `${zipRootFolder}/${relativeName}` });
      filesAdded += 1;
    }

    isTruncated = !!page.IsTruncated;
    continuationToken = page.NextContinuationToken;
  }

  if (filesAdded === 0) {
    throw new Error('The selected folder does not contain downloadable files');
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

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    for (const record of event.Records) {
      const job = parseSnsWrappedMessage(record.body);
      const createdAt = new Date().toISOString();

      const processingStatus: StoredFolderDownloadJobStatus = {
        JobId: job.JobId,
        LaboratoryId: job.LaboratoryId,
        Status: 'PROCESSING',
        RequestedPrefix: normalizePrefix(job.RequestedPrefix),
        ArchiveS3Key: job.ArchiveKey,
        CreatedAt: createdAt,
      };

      await writeStatus({
        s3Bucket: job.S3Bucket,
        statusKey: job.StatusKey,
        status: processingStatus,
      });

      try {
        await zipS3Prefix(job);

        await writeStatus({
          s3Bucket: job.S3Bucket,
          statusKey: job.StatusKey,
          status: {
            ...processingStatus,
            Status: 'COMPLETED',
            CompletedAt: new Date().toISOString(),
            ExpiresAt: new Date(Date.now() + DOWNLOAD_EXPIRY_MS).toISOString(),
          },
        });
      } catch (error: any) {
        await writeStatus({
          s3Bucket: job.S3Bucket,
          statusKey: job.StatusKey,
          status: {
            ...processingStatus,
            Status: 'FAILED',
            CompletedAt: new Date().toISOString(),
            ErrorMessage: error?.message || 'Unable to build folder archive',
            ExpiresAt: new Date(Date.now() + DOWNLOAD_EXPIRY_MS).toISOString(),
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
