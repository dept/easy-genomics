import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { getOrganizationAccessOrganizationIds, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationService = new OrganizationService();

/**
 * This API is returns a list of Organizations depending on the User's Cognito
 * Session.
 *
 * If the User is the SystemAdmin, then it will return all Organizations in the
 * platform. Otherwise if it is a normal User, then it will return only the
 * Organizations the User has been invited to.
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    if (validateSystemAdminAccess(event)) {
      const response: Organization[] = await organizationService.list();
      return buildResponse(200, JSON.stringify(response), event);
    } else {
      const organizationIds = getOrganizationAccessOrganizationIds(event);

      const response: Organization[] = await organizationService.list();
      const userOrganizations: Organization[] = response.filter((org: Organization) =>
        organizationIds.includes(org.OrganizationId),
      );

      return buildResponse(200, JSON.stringify(userOrganizations), event);
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
