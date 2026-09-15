import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
import {
  LaboratoryAccessDetails,
  OrganizationAccess,
  OrganizationAccessDetails,
  User,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayProxyWithCognitoAuthorizerEvent,
  Handler,
} from 'aws-lambda';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationUserService = new OrganizationUserService();
const userService = new UserService();

/**
 * True if the caller is an active Lab Manager for any laboratory in the org.
 * Lab managers need org user listings when adding users to a lab.
 */
function validateAnyLaboratoryManagerAccess(event: APIGatewayProxyEvent, organizationId: string): boolean {
  try {
    const orgAccessMetadata: string | undefined = event.requestContext.authorizer?.claims?.OrganizationAccess;
    if (!orgAccessMetadata) {
      return false;
    }

    const organizationAccess: OrganizationAccess = JSON.parse(orgAccessMetadata);
    const organizationAccessDetails: OrganizationAccessDetails | undefined = organizationAccess[organizationId];
    if (!organizationAccessDetails?.LaboratoryAccess) {
      return false;
    }

    return Object.values(organizationAccessDetails.LaboratoryAccess).some(
      (lab: LaboratoryAccessDetails) => lab.Status === 'Active' && lab.LabManager === true,
    );
  } catch (error) {
    console.error(error);
    return false;
  }
}

function canListUsersByOrganizationId(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  organizationId: string,
): boolean {
  return (
    !!validateSystemAdminAccess(event) ||
    !!validateOrganizationAdminAccess(event, organizationId) ||
    validateAnyLaboratoryManagerAccess(event, organizationId)
  );
}

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Query Parameter
    const organizationId: string | undefined = event.queryStringParameters?.organizationId;
    const userId: string | undefined = event.queryStringParameters?.userId;

    const organizationUsers: OrganizationUser[] = await listOrganizationUsers(event, organizationId, userId);

    if (organizationUsers.length === 0) {
      return buildResponse(200, JSON.stringify([]), event);
    }

    // Retrieve User Details for the list of OrganizationUsers for display
    const userIds: string[] = [...new Set(organizationUsers.map((orgUser) => orgUser.UserId))];
    const users: User[] = await userService.listUsers(userIds);

    const response: OrganizationUserDetails[] = organizationUsers
      .map((orgUser) => {
        const user: User | undefined = users.find((u) => u.UserId === orgUser.UserId); // Use find instead of filter and shift
        if (user) {
          const organizationAccess: OrganizationAccess | undefined =
            user.OrganizationAccess && organizationId
              ? { [organizationId]: user.OrganizationAccess[organizationId] }
              : user.OrganizationAccess;

          return {
            UserId: user.UserId,
            UserEmail: user.Email,
            UserStatus: user.Status,
            Title: user.Title,
            PreferredName: user.PreferredName,
            FirstName: user.FirstName,
            LastName: user.LastName,
            OrganizationId: orgUser.OrganizationId,
            OrganizationUserStatus: orgUser.Status,
            OrganizationAdmin: orgUser.OrganizationAdmin,
            OrganizationAccess: organizationAccess,
          } as OrganizationUserDetails;
        }
        return undefined;
      })
      .filter((item): item is OrganizationUserDetails => item !== undefined);

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

const listOrganizationUsers = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  organizationId?: string,
  userId?: string,
): Promise<OrganizationUser[]> => {
  if (organizationId && !userId) {
    if (!canListUsersByOrganizationId(event, organizationId)) {
      throw new UnauthorizedAccessError();
    }
    return organizationUserService.queryByOrganizationId(organizationId);
  }

  if (!organizationId && userId) {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    const isSystemAdmin = !!validateSystemAdminAccess(event);
    const isSelf = currentUserId === userId;

    if (isSystemAdmin || isSelf) {
      return organizationUserService.queryByUserId(userId);
    }

    // Org admins may only see memberships for orgs they administer
    const organizationUsers = await organizationUserService.queryByUserId(userId);
    const authorized = organizationUsers.filter(
      (orgUser) => !!validateOrganizationAdminAccess(event, orgUser.OrganizationId),
    );
    if (authorized.length === 0) {
      throw new UnauthorizedAccessError();
    }
    return authorized;
  }

  throw new InvalidRequestError();
};
