import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestLaboratoryBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/request-laboratory-bucket-objects';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { DataCollectionService } from '@BE/services/easy-genomics/data-collection-service';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '@BE/utils/laboratory-s3-access-utils';

const laboratoryService = new LaboratoryService();
const dataCollectionService = new DataCollectionService();
const s3AccessService = new LaboratoryS3AccessService();

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
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const s3Bucket = body.S3Bucket || laboratory.S3Bucket || '';
    if (!s3Bucket) {
      throw new InvalidRequestError('Laboratory has no S3 bucket configured');
    }

    await assertLaboratoryHasS3BucketAccess(laboratory, s3Bucket, s3AccessService);

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
    const maxTotalKeys = Math.min(body.MaxTotalKeys ?? 15_000, 50000);
    const maxTransactionFolders = Math.min(body.MaxTransactionFolders ?? 10_000, 50000);

    const { contents: allContents, listingTruncated } = await dataCollectionService.listTransactionInputs({
      bucket: s3Bucket,
      labPrefix: normalizedPrefix,
      pageSize,
      maxTotalKeys,
      maxTransactionFolders,
    });

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
        CommonPrefixes: [],
        IsTruncated: listingTruncated,
        S3Bucket: s3Bucket,
        ResolvedPrefix: normalizedPrefix,
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
