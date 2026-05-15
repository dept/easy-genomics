import { BucketLocationConstraint } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { RequestFileDownloadUrlSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-file-download-url';
import {
  FileDownloadUrlResponse,
  RequestFileDownloadUrl,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-file-download-url';
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

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();

/**
 * This API enables the Easy Genomics FE to request a secure pre-signed S3
 * download URL for a restricted file that exists within an AWS S3 Bucket that
 * the Easy Genomics deployment has access to.
 *
 * The AWS S3 Bucket must also belong to the same AWS Region for the Easy
 * Genomics deployment.
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Post Request Body
    const request: RequestFileDownloadUrl = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    // Data validation safety check
    if (!RequestFileDownloadUrlSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratoryId: string = request.LaboratoryId;
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

    // Only Organisation Admins and Laboratory Members are allowed to access downloads
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

    const s3Url: URL = new URL(request.S3Uri);
    const s3Bucket: string = s3Url.hostname;
    const s3Key: string = s3Url.pathname.replace(/^\/*/, ''); // Remove leading forward slashes

    // Security check: ensure the requested S3 object key belongs to the specified laboratory.
    // The key path is expected to contain the LaboratoryId as one of its path segments.
    const keyPathSegments = s3Key.split('/').filter(Boolean);
    if (!keyPathSegments.includes(laboratoryId)) {
      console.error(`Requested S3 object key '${s3Key}' does not belong to laboratory '${laboratoryId}'.`);
      throw new UnauthorizedAccessError();
    }

    // Check the S3 Bucket exists in the same AWS Region before creating Pre-Signed S3 Download URL
    const s3BucketLocation = await s3Service.getBucketLocation({ Bucket: s3Bucket });
    // S3 Buckets in 'us-east-1' returns a LocationConstrain of null
    const locationConstraint: BucketLocationConstraint | undefined = s3BucketLocation.LocationConstraint;

    if (
      (process.env.REGION === 'us-east-1' && locationConstraint && String(locationConstraint) !== 'us-east-1') ||
      (process.env.REGION !== 'us-east-1' && locationConstraint && String(locationConstraint) !== process.env.REGION)
    ) {
      console.error(
        `Requested S3 Bucket '${s3Bucket}' file download belongs in a different AWS Region from ${process.env.REGION}`,
      );
      throw new InvalidRequestError('file download belongs in a different AWS Region');
    }

    const preSignedS3DownloadUrl: string = await s3Service.getPreSignedDownloadUrl({
      Bucket: s3Bucket,
      Key: s3Key,
    });

    const response: FileDownloadUrlResponse = {
      DownloadUrl: preSignedS3DownloadUrl,
    };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
