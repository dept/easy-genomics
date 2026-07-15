import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { ListGrantedLaboratoryBucketsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { listDataTaggedS3Buckets } from '@BE/services/easy-genomics/s3-bucket-catalog-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { grantedBucketNamesForLaboratory } from '@BE/utils/laboratory-s3-access-utils';

const laboratoryService = new LaboratoryService();
const accessService = new LaboratoryS3AccessService();

/**
 * GET /easy-genomics/laboratory/s3-access/list-granted-buckets?laboratoryId=
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
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

    const [catalog, accessRows] = await Promise.all([
      listDataTaggedS3Buckets(),
      accessService.listByLaboratoryId(laboratoryId),
    ]);
    const buckets = grantedBucketNamesForLaboratory(laboratory, accessRows, catalog);

    const body: ListGrantedLaboratoryBucketsResponse = { buckets };
    return buildResponse(200, JSON.stringify(body), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
