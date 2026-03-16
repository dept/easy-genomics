import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import {
  ExpiredOrganizationAccessError,
  NoLabratoriesFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
  UserNotFoundError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import {
  getLaboratoryAccessLaboratoryIds,
  validateOrganizationAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
  verifyCurrentOrganizationAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Query Parameter
    const organizationId: string | undefined = event.queryStringParameters?.organizationId;
    if (!organizationId) throw new RequiredIdNotFoundError();

    const isSystemAdmin: boolean = validateSystemAdminAccess(event);
    const isOrgAdmin: boolean = validateOrganizationAdminAccess(event, organizationId);
    const isAdmin: boolean = isSystemAdmin || isOrgAdmin;

    if (!isSystemAdmin) {
      // For regular users only
      const userEmail = event.requestContext.authorizer.claims.email;
      const user: User | undefined = (await userService.queryByEmail(userEmail)).shift();

      if (!user) {
        throw new UserNotFoundError();
      }

      // Check if users org access is current, if not let the FE know
      if (!verifyCurrentOrganizationAccess(event, user)) {
        throw new ExpiredOrganizationAccessError();
      }
    }

    // Only the SystemAdmin or any User with access to the Organization is allowed access to this API
    if (!(isSystemAdmin || validateOrganizationAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const laboratories: Laboratory[] = await getLaboratories(event, organizationId, isAdmin);
    if (laboratories) {
      return buildResponse(200, JSON.stringify(laboratories), event);
    } else {
      throw new NoLabratoriesFoundError();
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

async function getLaboratories(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  organizationId: string,
  isAdmin: boolean,
): Promise<Laboratory[]> {
  const laboratories: Laboratory[] = await laboratoryService.queryByOrganizationId(organizationId);

  // If not SystemAdmin or OrganizationAdmin, then filter for the Laboratories the User has access to
  if (!isAdmin) {
    const laboratoryIds = getLaboratoryAccessLaboratoryIds(event, organizationId);
    return laboratories.filter((lab: Laboratory) => laboratoryIds.includes(lab.LaboratoryId));
  }

  return laboratories;
}
