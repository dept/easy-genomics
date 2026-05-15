import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryRunNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { ReadLaboratoryRun } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryRunService = new LaboratoryRunService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    // Get Laboratory Run
    const existing: LaboratoryRun = await laboratoryRunService.queryByRunId(id);

    if (!existing) {
      throw new LaboratoryRunNotFoundError(id);
    }

    // Only available for Org Admins or Laboratory Managers and Technicians
    if (
      !(
        validateOrganizationAdminAccess(event, existing.OrganizationId) ||
        validateLaboratoryManagerAccess(event, existing.OrganizationId, existing.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, existing.OrganizationId, existing.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    // Return Laboratory Run with settings object
    const response: ReadLaboratoryRun = {
      ...existing,
      Settings: JSON.parse(existing.Settings || '{}'),
    };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
