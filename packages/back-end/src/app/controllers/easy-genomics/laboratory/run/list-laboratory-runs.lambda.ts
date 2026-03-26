import { LaboratoryRunSchema } from '@easy-genomics/shared-lib/lib/app/schema/easy-genomics/laboratory-run';
import { ReadLaboratoryRun } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { getFilterResults, getFilters } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get mandatory query parameter(s)
    const laboratoryId: string | undefined = event.queryStringParameters?.LaboratoryId;
    if (!laboratoryId) {
      throw new InvalidRequestError();
    }

    // Check if laboratory exists and use it for permissions check
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) {
      throw new LaboratoryNotFoundError();
    }

    // Only available for Org Admins or Laboratory Managers and Technicians
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const laboratoryRuns: LaboratoryRun[] = await laboratoryRunService.queryByLaboratoryId(laboratoryId);

    // Get optional query parameter(s)
    const params = event.queryStringParameters ?? {};
    const queryParameters: [string, string][] = Object.entries(params).filter(
      (entry): entry is [string, string] => entry[0] !== 'LaboratoryId' && entry[1] !== undefined,
    );
    // Sanitize query parameters to the LaboratoryRun object's properties
    const filters: [string, string][] = getFilters(Object.keys(LaboratoryRunSchema.shape), queryParameters);

    const laboratoryRunsFiltered: LaboratoryRun[] = filters.length
      ? getFilterResults<LaboratoryRun>(laboratoryRuns, filters)
      : laboratoryRuns;

    const results: ReadLaboratoryRun[] = laboratoryRunsFiltered.map((laboratoryRun: LaboratoryRun) => {
      const readLaboratoryRun: ReadLaboratoryRun = {
        ...laboratoryRun,
        Settings: JSON.parse(laboratoryRun.Settings || '{}'),
      };
      return readLaboratoryRun;
    });

    return buildResponse(200, JSON.stringify(results), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
