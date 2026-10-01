import { Readable } from 'stream';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RequestRunExportJobStatus,
  RequestRunExportJobStatusSchema,
  RunExportDestination,
  RunExportJobStatus,
  RunExportJobStatusResponse,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run/request-run-export-job';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '@BE/utils/laboratory-s3-access-utils';
import { RUN_EXPORT_JOBS_PREFIX, safeRunFolderName } from '@BE/utils/run-export-utils';

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();
const s3AccessService = new LaboratoryS3AccessService();

export type StoredRunExportJobStatus = {
  JobId: string;
  LaboratoryId: string;
  RunId?: string;
  RunIds?: string[];
  RunName?: string;
  Destination?: RunExportDestination;
  Status: RunExportJobStatus;
  SourcePrefix?: string;
  ArchiveS3Key?: string;
  DestBucket?: string;
  DestPrefix?: string;
  FilesCopied?: number;
  CreatedAt: string;
  ExpiresAt?: string;
  CompletedAt?: string;
  ErrorMessage?: string;
};

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

/**
 * Returns status for a run-export job, plus a signed ZIP URL or destination URI when complete.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: RequestRunExportJobStatus = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    if (!RequestRunExportJobStatusSchema.safeParse(request).success) {
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

    const s3Bucket = laboratory.S3Bucket || '';
    if (!s3Bucket) {
      throw new InvalidRequestError('Laboratory does not have an S3 bucket configured');
    }
    await assertLaboratoryHasS3BucketAccess(laboratory, s3Bucket, s3AccessService);

    const laboratoryOwnedPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const statusKey = `${laboratoryOwnedPrefix}${RUN_EXPORT_JOBS_PREFIX}/${request.JobId}.json`;

    const statusObject = await s3Service.getObject({
      Bucket: s3Bucket,
      Key: statusKey,
    });
    const statusJson = await streamToString(statusObject.Body);
    if (!statusJson) {
      throw new InvalidRequestError('Export job status is unavailable');
    }
    const parsedStatus = JSON.parse(statusJson) as StoredRunExportJobStatus;

    if (parsedStatus.ExpiresAt && new Date(parsedStatus.ExpiresAt).getTime() <= Date.now()) {
      if (parsedStatus.ArchiveS3Key) {
        await s3Service.deleteObject({
          Bucket: s3Bucket,
          Key: parsedStatus.ArchiveS3Key,
        });
      }
      await s3Service.deleteObject({
        Bucket: s3Bucket,
        Key: statusKey,
      });
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
      const runIds = parsedStatus.RunIds?.length ? parsedStatus.RunIds : parsedStatus.RunId ? [parsedStatus.RunId] : [];
      const folderName =
        runIds.length === 1
          ? safeRunFolderName(parsedStatus.RunName, runIds[0])
          : `bundle-${Math.max(runIds.length, 1)}-runs`;
      response.DownloadUrl = await s3Service.getPreSignedDownloadUrl({
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
      response.DestinationS3Uri = `s3://${parsedStatus.DestBucket}/${parsedStatus.DestPrefix}`;
    }

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
