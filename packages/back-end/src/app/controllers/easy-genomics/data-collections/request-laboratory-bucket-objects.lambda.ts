import { ListObjectsV2CommandOutput, _Object } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestLaboratoryBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/request-laboratory-bucket-objects';
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

function isFileObjectKey(key: string | undefined): boolean {
  return !!key && !key.endsWith('/');
}

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    if (!RequestLaboratoryBucketObjectsSchema.safeParse(body).success) {
      throw new InvalidRequestError();
    }

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(body.LaboratoryId);
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const s3Bucket = laboratory.S3Bucket || '';
    if (!s3Bucket) {
      throw new InvalidRequestError('Laboratory has no S3 bucket configured');
    }

    const labRoot = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const relative = (body.RelativePrefix || '').replace(/^\/*/, '');
    let normalizedPrefix = `${labRoot}${relative}`;
    if (!normalizedPrefix.endsWith('/')) {
      normalizedPrefix = `${normalizedPrefix}/`;
    }
    if (!normalizedPrefix.startsWith(labRoot)) {
      throw new UnauthorizedAccessError();
    }

    const pageSize = Math.min(body.MaxKeys ?? 1000, 1000);
    const recursive = body.Recursive === true;

    let allContents: _Object[] = [];
    let allCommonPrefixes: { Prefix: string }[] = [];
    let isTruncated = true;
    let continuationToken: string | undefined = undefined;
    let listingTruncated = false;

    if (!recursive) {
      while (isTruncated) {
        const response: ListObjectsV2CommandOutput = await s3Service.listBucketObjectsV2({
          Bucket: s3Bucket,
          Prefix: normalizedPrefix,
          Delimiter: '/',
          MaxKeys: pageSize,
          ContinuationToken: continuationToken,
        });

        if (response.Contents) {
          allContents = allContents.concat(response.Contents);
        }

        if (response.CommonPrefixes) {
          allCommonPrefixes = allCommonPrefixes.concat(response.CommonPrefixes);
        }

        isTruncated = !!response.IsTruncated;
        continuationToken = response.NextContinuationToken;
      }
    } else {
      const maxTotalKeys = Math.min(body.MaxTotalKeys ?? 15000, 50000);
      isTruncated = true;
      continuationToken = undefined;

      while (isTruncated && allContents.length < maxTotalKeys) {
        const remaining = maxTotalKeys - allContents.length;
        const requestMax = Math.max(1, Math.min(pageSize, remaining));

        const response: ListObjectsV2CommandOutput = await s3Service.listBucketObjectsV2({
          Bucket: s3Bucket,
          Prefix: normalizedPrefix,
          MaxKeys: requestMax,
          ContinuationToken: continuationToken,
        });

        for (const obj of response.Contents || []) {
          if (!isFileObjectKey(obj.Key)) {
            continue;
          }
          if (allContents.length >= maxTotalKeys) {
            listingTruncated = true;
            break;
          }
          allContents.push(obj);
        }

        const s3More = !!response.IsTruncated;
        continuationToken = response.NextContinuationToken;
        if (listingTruncated) {
          isTruncated = false;
          break;
        }
        isTruncated = s3More;
        if (!s3More) {
          break;
        }
        if (allContents.length >= maxTotalKeys) {
          listingTruncated = true;
          break;
        }
      }
    }

    return buildResponse(
      200,
      JSON.stringify({
        $metadata: {
          httpStatusCode: 200,
          requestId: event.requestContext.requestId,
          extendedRequestId: event.requestContext.extendedRequestId || 'unknown',
          attempts: 1,
          totalRetryDelay: 0,
        },
        Contents: allContents,
        CommonPrefixes: allCommonPrefixes,
        IsTruncated: recursive ? listingTruncated : false,
        S3Bucket: s3Bucket,
        ResolvedPrefix: normalizedPrefix,
        Recursive: recursive,
        ListingTruncated: listingTruncated,
        ReturnedKeyCount: allContents.length,
      }),
      event,
    );
  } catch (error: any) {
    console.error('ERROR: ' + JSON.stringify(error));
    return buildErrorResponse(error, event);
  }
};
