import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestFolderDownloadJobStatusSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-folder-download-job-status';
import {
  FolderDownloadJobStatusResponse,
  RequestFolderDownloadJobStatus,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { s3BodyToString } from '@BE/utils/s3-object-body';

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();

const DOWNLOAD_JOBS_PREFIX = '.downloads/jobs';

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

const getDownloadFileName = (requestedPrefix: string): string => {
  const trimmedPrefix = requestedPrefix.replace(/\/+$/, '');
  const lastSegment = trimmedPrefix.split('/').filter(Boolean).pop() || 'folder-download';
  const safeName = lastSegment.replace(/[^\w.-]/g, '_');
  return `${safeName}.zip`;
};

/**
 * Returns the status for a folder-download job and a signed zip URL once complete.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: RequestFolderDownloadJobStatus = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    if (!RequestFolderDownloadJobStatusSchema.safeParse(request).success) {
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

    const laboratoryOwnedPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const statusKey = `${laboratoryOwnedPrefix}${DOWNLOAD_JOBS_PREFIX}/${request.JobId}.json`;

    const statusObject = await s3Service.getObject({
      Bucket: s3Bucket,
      Key: statusKey,
    });
    const statusJson = await s3BodyToString(statusObject.Body);
    if (!statusJson) {
      throw new InvalidRequestError('Download job status is unavailable');
    }
    const parsedStatus = JSON.parse(statusJson) as StoredFolderDownloadJobStatus;

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
      throw new InvalidRequestError('Download has expired. Please request the folder download again.');
    }

    const response: FolderDownloadJobStatusResponse = {
      JobId: parsedStatus.JobId,
      Status: parsedStatus.Status,
      ErrorMessage: parsedStatus.ErrorMessage,
    };

    if (parsedStatus.Status === 'COMPLETED' && parsedStatus.ArchiveS3Key) {
      const downloadFileName = getDownloadFileName(parsedStatus.RequestedPrefix);
      response.DownloadUrl = await s3Service.getPreSignedDownloadUrl({
        Bucket: s3Bucket,
        Key: parsedStatus.ArchiveS3Key,
        ResponseContentDisposition: `attachment; filename="${downloadFileName}"`,
      });
    }

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
