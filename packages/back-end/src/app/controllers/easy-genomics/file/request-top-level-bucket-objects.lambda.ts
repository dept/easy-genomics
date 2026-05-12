import { ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestTopLevelBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/file/request-top-level-bucket-objects';
import { RequestTopLevelBucketObjects } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/file/request-top-level-bucket-objects';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const s3Service = new S3Service();

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

const getParentPrefix = (prefix: string): string | null => {
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const trimmed = normalized.replace(/\/+$/, '');
  const lastSlashIdx = trimmed.lastIndexOf('/');
  if (lastSlashIdx < 0) return null;
  const parent = trimmed.slice(0, lastSlashIdx);
  return parent ? `${parent}/` : null;
};

/**
 * This API enables the Easy Genomics FE to request only the top-level (direct children)
 * objects and prefixes at a given S3 path for lazy-loading in the File Manager UI.
 *
 * Uses S3's Delimiter parameter to return only objects at the specified prefix level.
 * Automatically paginates through all items at that level to return the complete set,
 * even if there are >1000 items, while avoiding loading the entire bucket.
 *
 * Returns both:
 * - Contents: ALL files at this level (paginated internally)
 * - CommonPrefixes: ALL directories (folders) at this level
 *
 * @param event APIGatewayProxyWithCognitoAuthorizerEvent
 *   Body: { LaboratoryId, RunId?, S3Bucket?, S3Prefix?, MaxKeys? }
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Post Request Body
    const request: RequestTopLevelBucketObjects = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    // Data validation safety check
    if (!RequestTopLevelBucketObjectsSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratoryId: string = request.LaboratoryId;
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

    // Only Organisation Admins and Laboratory Members are allowed to access file listings
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
    const requestBucket: string = request.S3Bucket || prefixFromUri?.bucket || laboratory.S3Bucket || '';
    let s3Bucket: string = requestBucket;
    let s3Prefix: string = providedPrefix || `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;

    if (request.S3Bucket && prefixFromUri?.bucket && request.S3Bucket !== prefixFromUri.bucket) {
      throw new InvalidRequestError('S3 bucket mismatch between S3Bucket and S3Prefix URI');
    }

    // If a RunId is provided, authorize the requested S3 prefix against the run OutputS3Url (supports custom output dirs).
    // Otherwise, fall back to the original lab-owned prefix constraint.
    let normalizedPrefix = s3Prefix.endsWith('/') ? s3Prefix : `${s3Prefix}/`;
    if (request.RunId) {
      const run = await laboratoryRunService.get(laboratoryId, request.RunId);
      const outputFromUri = run.OutputS3Url ? parseS3Uri(run.OutputS3Url) : null;
      const outputBucket = outputFromUri?.bucket || laboratory.S3Bucket || requestBucket;
      const outputPrefix = outputFromUri?.prefix || run.OutputS3Url || '';
      const normalizedOutputPrefix = outputPrefix.endsWith('/') ? outputPrefix : `${outputPrefix}/`;

      if (!normalizedOutputPrefix || normalizedOutputPrefix === '/') {
        throw new InvalidRequestError('Invalid OutputS3Url for run');
      }

      // Bucket must match the run output bucket
      if (s3Bucket && outputBucket && s3Bucket !== outputBucket) {
        throw new UnauthorizedAccessError();
      }
      s3Bucket = outputBucket;

      // If client didn't pass S3Prefix, list from the run output root.
      if (!providedPrefix) {
        s3Prefix = normalizedOutputPrefix;
        normalizedPrefix = normalizedOutputPrefix;
      }

      // Allow listing:
      // - within the run OutputS3Url prefix (the most restricted case), OR
      // - exactly at its immediate parent (so UI can show the run root when OutputS3Url points to e.g. ".../results/").
      const outputParentPrefix = getParentPrefix(normalizedOutputPrefix);
      const isWithinOutput = normalizedPrefix.startsWith(normalizedOutputPrefix);
      const isImmediateParent = outputParentPrefix ? normalizedPrefix === outputParentPrefix : false;
      if (!isWithinOutput && !isImmediateParent) {
        throw new UnauthorizedAccessError();
      }
    } else {
      if (laboratory.S3Bucket && s3Bucket !== laboratory.S3Bucket) {
        throw new UnauthorizedAccessError();
      }

      const laboratoryOwnedPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
      if (!normalizedPrefix.startsWith(laboratoryOwnedPrefix)) {
        throw new UnauthorizedAccessError();
      }
    }

    // Fetch ALL top-level objects at this prefix level using Delimiter for lazy-loading
    // Pagination is needed if there are >1000 items at this level
    let allContents: any[] = [];
    let allCommonPrefixes: any[] = [];
    let isTruncated = true;
    let continuationToken: string | undefined = undefined;

    while (isTruncated) {
      const response: ListObjectsV2CommandOutput = await s3Service.listBucketObjectsV2({
        Bucket: s3Bucket,
        Prefix: normalizedPrefix,
        Delimiter: '/', // S3 uses "/" as delimiter for "folders"
        MaxKeys: request.MaxKeys || 1000,
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
        IsTruncated: false, // We've paginated through everything, so it's never truncated from FE perspective
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
