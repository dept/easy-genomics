import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { S3Service } from '@BE/services/s3-service';
import { zipS3ObjectsToArchive, type S3ZipArchiveEntry } from '@BE/utils/s3-zip-archive';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';

const s3Service = new S3Service();
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

const parseSnsWrappedMessage = (body: string): FolderDownloadJobMessage =>
  parseSqsJsonBody<FolderDownloadJobMessage>(body);

const zipS3Prefix = async (job: FolderDownloadJobMessage): Promise<void> => {
  const normalizedPrefix = normalizePrefix(job.RequestedPrefix);
  const zipRootFolder = getZipRootFolderName(normalizedPrefix);
  const entries: S3ZipArchiveEntry[] = [];

  let continuationToken: string | undefined = undefined;
  let isTruncated = true;

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
      entries.push({
        sourceBucket: job.S3Bucket,
        sourceKey: key,
        archivePath: `${zipRootFolder}/${relativeName}`,
      });
    }

    isTruncated = !!page.IsTruncated;
    continuationToken = page.NextContinuationToken;
  }

  if (entries.length === 0) {
    throw new Error('The selected folder does not contain downloadable files');
  }

  await zipS3ObjectsToArchive({
    s3: s3Service,
    destinationBucket: job.S3Bucket,
    destinationKey: job.ArchiveKey,
    entries,
  });
};

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
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
