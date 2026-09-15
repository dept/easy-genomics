import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { OrganizationLogoUploadRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization-email-branding';
import {
  OrganizationLogoUploadInfo,
  OrganizationLogoUploadRequest,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-email-branding';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { S3Service } from '@BE/services/s3-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const s3Service = new S3Service();

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/**
 * This POST /easy-genomics/organization/create-organization-logo-upload-request
 * API generates a pre-signed S3 upload URL for an org's email-branding logo.
 *
 * OrganizationId travels in the request body rather than the URL path: the 'create-'
 * Lambda filename verb never registers a path-level {id} resource (only read-/update-/
 * cancel-/patch-/delete- do — see ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID in
 * verb-operations.ts and lambda-construct.ts), so this mirrors the existing
 * LaboratoryId-in-body pattern used by create-file-upload-request.lambda.ts.
 *
 * The object key is versioned with Date.now() rather than fixed at {organizationId}/logo.{ext}:
 * the URL is persisted on the Organization record and served through CloudFront, so a stable key
 * would let a replaced logo keep rendering from cache for up to a day. A ?v= query parameter
 * cannot do the job because CACHING_OPTIMIZED excludes query strings from the cache key, and
 * explicit invalidation is not available — the browser PUTs direct to S3 with a presigned URL, so
 * this handler never learns the upload completed. The tradeoff is that a re-upload orphans the
 * previous object; one small image per re-upload per org.
 *
 * PublicUrl is on the CloudFront domain because the bucket is private. S3Url stays on the S3
 * endpoint — it is the presigned PUT the browser uploads to.
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: OrganizationLogoUploadRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!OrganizationLogoUploadRequestSchema.safeParse(request).success) throw new InvalidRequestError();

    const organizationId: string = request.OrganizationId;
    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const bucket = process.env.ORG_EMAIL_ASSETS_BUCKET_NAME!;
    const region = process.env.REGION!;
    const extension = CONTENT_TYPE_EXTENSIONS[request.ContentType];
    const key = `${organizationId}/logo-${Date.now()}.${extension}`;

    const s3Url = await s3Service.getPreSignedUploadUrl({
      Bucket: bucket,
      Key: key,
      ContentType: request.ContentType,
      ContentLength: request.ContentLength,
    });

    const response: OrganizationLogoUploadInfo = {
      Bucket: bucket,
      Key: key,
      Region: region,
      S3Url: s3Url,
      PublicUrl: `https://${process.env.ORG_EMAIL_ASSETS_CDN_DOMAIN}/${key}`,
    };
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
