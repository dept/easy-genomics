import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { ListS3BucketCatalogResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { listDataTaggedS3Buckets } from '@BE/services/easy-genomics/s3-bucket-catalog-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

/**
 * GET /easy-genomics/organization/s3-access/list-s3-bucket-catalog?organizationId=
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const organizationId: string = event.queryStringParameters?.organizationId || '';
    if (organizationId === '') throw new RequiredIdNotFoundError('organizationId');

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const buckets = await listDataTaggedS3Buckets();
    const body: ListS3BucketCatalogResponse = { buckets };
    return buildResponse(200, JSON.stringify(body), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
