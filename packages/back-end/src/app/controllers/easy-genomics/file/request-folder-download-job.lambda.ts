import { Readable } from 'stream';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { RequestFolderDownloadJobSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-folder-download-job';
import {
  FolderDownloadJobResponse,
  RequestFolderDownloadJob,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-folder-download-job';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import { SnsService } from '@BE/services/sns-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();
const snsService = new SnsService();

const DOWNLOAD_JOBS_PREFIX = '.downloads/jobs';
const DOWNLOAD_ARCHIVES_PREFIX = '.downloads/archives';
const MAX_DOWNLOAD_SIZE_BYTES = 3 * 1024 * 1024 * 1024; // 3GB
const FOLDER_SIZE_EXCEEDED_MESSAGE =
  'This folder is too large to download as a single ZIP file. You can download files individually, or contact support for assistance retrieving the full dataset.';
const DOWNLOAD_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

const parseS3Uri = (value: string): { bucket: string; prefix: string } | null => {
  if (!value.startsWith('s3://')) return null;
  try {
    const s3Url = new URL(value);
    return {
      bucket: s3Url.hostname,
      prefix: s3Url.pathname.replace(/^\/*/, ''),
    };
  } catch {
    throw new InvalidRequestError('Invalid S3 URI');
  }
};

const normalizePrefix = (prefix: string): string => (prefix.endsWith('/') ? prefix : `${prefix}/`);

const streamToString = async (body: unknown): Promise<string> => {
  if (!body) return '';
  const bodyWithTransform = body as { transformToString?: () => Promise<string> };
  if (typeof bodyWithTransform.transformToString === 'function') {
    return bodyWithTransform.transformToString();
  }

  const readable = body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
};

const getRequestedPrefixSize = async (bucket: string, prefix: string): Promise<number> => {
  let totalBytes = 0;
  let continuationToken: string | undefined = undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await s3Service.listBucketObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });

    for (const object of response.Contents || []) {
      const key = object.Key || '';
      if (!key || key.endsWith('/')) continue;
      totalBytes += object.Size || 0;
      if (totalBytes > MAX_DOWNLOAD_SIZE_BYTES) {
        return totalBytes;
      }
    }

    isTruncated = !!response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }

  return totalBytes;
};

const cleanupExpiredDownloadArtifacts = async (bucket: string, laboratoryOwnedPrefix: string): Promise<void> => {
  let continuationToken: string | undefined = undefined;
  let isTruncated = true;
  const jobsPrefix = `${laboratoryOwnedPrefix}${DOWNLOAD_JOBS_PREFIX}/`;

  while (isTruncated) {
    const listResponse = await s3Service.listBucketObjectsV2({
      Bucket: bucket,
      Prefix: jobsPrefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });

    for (const object of listResponse.Contents || []) {
      const statusKey = object.Key;
      if (!statusKey || statusKey.endsWith('/')) continue;

      try {
        const statusObject = await s3Service.getObject({
          Bucket: bucket,
          Key: statusKey,
        });
        const statusJson = await streamToString(statusObject.Body);
        if (!statusJson) continue;
        const status = JSON.parse(statusJson) as { ExpiresAt?: string; ArchiveS3Key?: string };
        if (!status.ExpiresAt) continue;

        if (new Date(status.ExpiresAt).getTime() <= Date.now()) {
          if (status.ArchiveS3Key) {
            await s3Service.deleteObject({
              Bucket: bucket,
              Key: status.ArchiveS3Key,
            });
          }
          await s3Service.deleteObject({
            Bucket: bucket,
            Key: statusKey,
          });
        }
      } catch (error) {
        console.warn(`Failed to cleanup download artifact for key '${statusKey}':`, error);
      }
    }

    isTruncated = !!listResponse.IsTruncated;
    continuationToken = listResponse.NextContinuationToken;
  }
};

type FolderDownloadJobMessage = {
  JobId: string;
  LaboratoryId: string;
  OrganizationId: string;
  S3Bucket: string;
  RequestedPrefix: string;
  ArchiveKey: string;
  StatusKey: string;
};

/**
 * Creates an async folder-download job that will package the requested S3 prefix as a zip.
 * The heavy work is delegated to a queue worker so the FE remains responsive for large folders.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const request: RequestFolderDownloadJob = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    if (!RequestFolderDownloadJobSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);

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

    const prefixFromUri = parseS3Uri(request.S3Prefix);
    const providedPrefix = prefixFromUri?.prefix || request.S3Prefix;
    const s3Bucket = request.S3Bucket || prefixFromUri?.bucket || laboratory.S3Bucket || '';
    if (!s3Bucket) {
      throw new InvalidRequestError('Missing S3 bucket');
    }

    if (request.S3Bucket && prefixFromUri?.bucket && request.S3Bucket !== prefixFromUri.bucket) {
      throw new InvalidRequestError('S3 bucket mismatch between S3Bucket and S3Prefix URI');
    }

    if (laboratory.S3Bucket && s3Bucket !== laboratory.S3Bucket) {
      throw new UnauthorizedAccessError();
    }

    const requestedPrefix = normalizePrefix(providedPrefix);
    const laboratoryOwnedPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    if (!requestedPrefix.startsWith(laboratoryOwnedPrefix)) {
      throw new UnauthorizedAccessError();
    }
    const keyPathSegments = requestedPrefix.split('/').filter(Boolean);
    if (!keyPathSegments.includes(request.LaboratoryId)) {
      throw new UnauthorizedAccessError();
    }

    await cleanupExpiredDownloadArtifacts(s3Bucket, laboratoryOwnedPrefix);

    const folderSizeBytes = await getRequestedPrefixSize(s3Bucket, requestedPrefix);
    if (folderSizeBytes > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new InvalidRequestError(FOLDER_SIZE_EXCEEDED_MESSAGE);
    }

    const jobId = uuidv4();
    const statusKey = `${laboratoryOwnedPrefix}${DOWNLOAD_JOBS_PREFIX}/${jobId}.json`;
    const archiveKey = `${laboratoryOwnedPrefix}${DOWNLOAD_ARCHIVES_PREFIX}/${jobId}.zip`;

    await s3Service.putObject({
      Bucket: s3Bucket,
      Key: statusKey,
      ContentType: 'application/json',
      Body: JSON.stringify({
        JobId: jobId,
        LaboratoryId: laboratory.LaboratoryId,
        Status: 'PENDING',
        RequestedPrefix: requestedPrefix,
        ArchiveS3Key: archiveKey,
        CreatedAt: new Date().toISOString(),
        ExpiresAt: new Date(Date.now() + DOWNLOAD_EXPIRY_MS).toISOString(),
      }),
    });

    const topicArn = process.env.SNS_FOLDER_DOWNLOAD_TOPIC || '';
    if (!topicArn) {
      throw new Error('Missing SNS_FOLDER_DOWNLOAD_TOPIC environment variable');
    }

    const message: FolderDownloadJobMessage = {
      JobId: jobId,
      LaboratoryId: laboratory.LaboratoryId,
      OrganizationId: laboratory.OrganizationId,
      S3Bucket: s3Bucket,
      RequestedPrefix: requestedPrefix,
      ArchiveKey: archiveKey,
      StatusKey: statusKey,
    };

    await snsService.publish({
      TopicArn: topicArn,
      MessageGroupId: laboratory.LaboratoryId,
      MessageDeduplicationId: `${jobId}-${Date.now()}`,
      Message: JSON.stringify(message),
    });

    const response: FolderDownloadJobResponse = {
      JobId: jobId,
      Status: 'PENDING',
    };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
