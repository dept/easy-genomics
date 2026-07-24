import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { ListLaboratoryS3AccessAssignmentsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const accessService = new LaboratoryS3AccessService();

/**
 * GET /easy-genomics/organization/s3-access/list-s3-access-assignments?organizationId=
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

    const laboratories: Laboratory[] = await laboratoryService.queryByOrganizationId(organizationId);
    const rowsNested = await Promise.all(laboratories.map((lab) => accessService.listByLaboratoryId(lab.LaboratoryId)));
    const assignments = rowsNested.flat();

    const body: ListLaboratoryS3AccessAssignmentsResponse = { assignments };
    return buildResponse(200, JSON.stringify(body), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
