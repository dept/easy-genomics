import { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestListBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-list-bucket-objects';
import { RequestListBucketObjects } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-list-bucket-objects';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();

/**
 * This API enables the Easy Genomics FE to request the specified S3 Bucket's
 * objects for display in the File Manager UI.
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Post Request Body
    const request: RequestListBucketObjects = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    // Data validation safety check
    if (!RequestListBucketObjectsSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratoryId: string = request.LaboratoryId;
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

    // Only Organisation Admins and Laboratory Members are allowed to access downloads
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const s3Bucket: string = request.S3Bucket ? request.S3Bucket : laboratory.S3Bucket || '';
    const s3Prefix: string = request.S3Prefix
      ? request.S3Prefix
      : `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;

    let isTruncated = true;
    let continuationToken: string | undefined = undefined;
    let allContents: any[] = [];
    let firstResponse: ListObjectsV2CommandOutput | undefined = undefined;

    while (isTruncated) {
      const response: ListObjectsV2CommandOutput = await s3Service.listBucketObjectsV2({
        Bucket: s3Bucket,
        Prefix: s3Prefix,
        MaxKeys: request.MaxKeys,
        ContinuationToken: continuationToken,
      });
      if (!firstResponse) firstResponse = response;
      if (response.Contents) allContents = allContents.concat(response.Contents);
      isTruncated = !!response.IsTruncated;
      continuationToken = response.NextContinuationToken;
    }

    const mergedResponse = {
      ...(firstResponse || {}),
      Contents: allContents,
    };
    return buildResponse(200, JSON.stringify(mergedResponse), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
