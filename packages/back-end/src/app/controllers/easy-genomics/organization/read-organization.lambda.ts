import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { validateOrganizationAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationService = new OrganizationService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    // Only System Admins or Users with access to the Organization can view the organization
    if (!(validateSystemAdminAccess(event) || validateOrganizationAccess(event, id))) {
      throw new UnauthorizedAccessError();
    }

    const existing: Organization = await organizationService.get(id);
    return buildResponse(200, JSON.stringify(existing), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
