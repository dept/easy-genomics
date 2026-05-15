import { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { RequestSearchBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-search-bucket-objects';
import { RequestSearchBucketObjects } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-search-bucket-objects';
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

const DEFAULT_MAX_RESULTS = 200;

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

/**
 * Search S3 objects under a prefix and return only matching file objects.
 * Keeps FE lazy-loading for navigation while delegating global search to backend.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const request: RequestSearchBucketObjects = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    if (!RequestSearchBucketObjectsSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratoryId: string = request.LaboratoryId;
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

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

    const prefixFromUri = request.S3Prefix ? parseS3Uri(request.S3Prefix) : null;
    const providedPrefix = prefixFromUri?.prefix || request.S3Prefix;
    const s3Bucket: string = request.S3Bucket || prefixFromUri?.bucket || laboratory.S3Bucket || '';
    const s3Prefix: string = providedPrefix || `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;

    if (request.S3Bucket && prefixFromUri?.bucket && request.S3Bucket !== prefixFromUri.bucket) {
      throw new InvalidRequestError('S3 bucket mismatch between S3Bucket and S3Prefix URI');
    }

    if (laboratory.S3Bucket && s3Bucket !== laboratory.S3Bucket) {
      throw new UnauthorizedAccessError();
    }

    const normalizedPrefix = s3Prefix.endsWith('/') ? s3Prefix : `${s3Prefix}/`;
    const laboratoryOwnedPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    if (!normalizedPrefix.startsWith(laboratoryOwnedPrefix)) {
      throw new UnauthorizedAccessError();
    }

    const normalizedSearch = request.SearchQuery.trim().toLowerCase();
    const maxResults = request.MaxResults || DEFAULT_MAX_RESULTS;

    let isTruncated = true;
    let continuationToken: string | undefined = undefined;
    const matchedContents: any[] = [];
    const matchedDirectoryPrefixes = new Set<string>();

    while (isTruncated && matchedContents.length + matchedDirectoryPrefixes.size < maxResults) {
      const response: ListObjectsV2CommandOutput = await s3Service.listBucketObjectsV2({
        Bucket: s3Bucket,
        Prefix: normalizedPrefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });

      const filtered = (response.Contents || []).filter((item) => {
        const key = item.Key || '';
        const relativePath = key.startsWith(normalizedPrefix) ? key.slice(normalizedPrefix.length) : key;
        if (!relativePath) return false;

        const pathSegments = relativePath.split('/').filter(Boolean);
        pathSegments.slice(0, -1).forEach((segment, index) => {
          if (segment.toLowerCase().includes(normalizedSearch)) {
            const directoryPrefix = `${normalizedPrefix}${pathSegments.slice(0, index + 1).join('/')}/`;
            matchedDirectoryPrefixes.add(directoryPrefix);
          }
        });

        if (key.endsWith('/')) {
          return false;
        }

        return relativePath.toLowerCase().includes(normalizedSearch);
      });

      if (filtered.length > 0) {
        matchedContents.push(...filtered);
      }

      isTruncated = !!response.IsTruncated;
      continuationToken = response.NextContinuationToken;
    }

    const matchedPrefixes = Array.from(matchedDirectoryPrefixes).sort();
    const limitedFiles = matchedContents.slice(0, maxResults);
    const remainingForDirectories = Math.max(0, maxResults - limitedFiles.length);
    const limitedPrefixes = matchedPrefixes.slice(0, remainingForDirectories);
    const hasMoreMatches = matchedContents.length + matchedPrefixes.length > maxResults;

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
        Contents: limitedFiles,
        CommonPrefixes: limitedPrefixes.map((prefix) => ({ Prefix: prefix })),
        IsTruncated: isTruncated || hasMoreMatches,
      }),
    );
  } catch (error: any) {
    console.error('ERROR: ' + JSON.stringify(error));
    if (error instanceof InvalidRequestError) {
      return buildErrorResponse(error);
    }
    if (error instanceof UnauthorizedAccessError) {
      return buildErrorResponse(error);
    }
    return buildErrorResponse(new Error('Internal server error'));
  }
};
