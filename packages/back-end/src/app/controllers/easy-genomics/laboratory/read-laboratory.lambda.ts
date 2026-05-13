import { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { ReadLaboratory } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SsmService } from '@BE/services/ssm-service';
import {
  validateOrganizationAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const ssmService = new SsmService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    // Lookup by GSI Id for convenience
    const existing: Laboratory = await laboratoryService.queryByLaboratoryId(id);

    // Only the SystemAdmin or any User with access to the Laboratory is allowed access to this API
    if (
      !(
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, existing.OrganizationId) ||
        validateOrganizationAccess(event, existing.OrganizationId, existing.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const hasNextFlowAccessToken: boolean = await ssmService
      .getParameter({
        Name: `/easy-genomics/organization/${existing.OrganizationId}/laboratory/${existing.LaboratoryId}/nf-access-token`,
      })
      .then((value: GetParameterCommandOutput) => !!value.Parameter)
      .catch(() => {
        return false;
      });

    // Return Laboratory details with boolean indicator instead of actual NextFlowTowerAccessToken
    const response: ReadLaboratory = {
      ...existing,
      HasNextFlowTowerAccessToken: hasNextFlowAccessToken,
    };
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
