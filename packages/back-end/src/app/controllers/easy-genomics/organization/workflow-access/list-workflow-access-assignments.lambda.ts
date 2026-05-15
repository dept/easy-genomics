import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { ListLaboratoryWorkflowAccessAssignmentsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const accessService = new LaboratoryWorkflowAccessService();

/**
 * GET /easy-genomics/organization/workflow-access/list-workflow-access-assignments?organizationId=
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const organizationId: string = event.queryStringParameters?.organizationId || '';
    if (organizationId === '') throw new RequiredIdNotFoundError('organizationId');

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const laboratories: Laboratory[] = await laboratoryService.queryByOrganizationId(organizationId);
    const rowsNested = await Promise.all(laboratories.map((lab) => accessService.listByLaboratoryId(lab.LaboratoryId)));
    const assignments = rowsNested.flat();

    const body: ListLaboratoryWorkflowAccessAssignmentsResponse = { assignments };
    return buildResponse(200, JSON.stringify(body), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
