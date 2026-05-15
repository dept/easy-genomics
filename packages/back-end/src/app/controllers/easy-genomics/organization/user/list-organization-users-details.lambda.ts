import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
import { OrganizationAccess, User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';

const organizationUserService = new OrganizationUserService();
const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Get Query Parameter
    const organizationId: string | undefined = event.queryStringParameters?.organizationId;
    const userId: string | undefined = event.queryStringParameters?.userId;

    const organizationUsers: OrganizationUser[] = await listOrganizationUsers(organizationId, userId);

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

const listOrganizationUsers = (organizationId?: string, userId?: string): Promise<OrganizationUser[]> => {
  if (organizationId && !userId) {
    return organizationUserService.queryByOrganizationId(organizationId);
  } else if (!organizationId && userId) {
    return organizationUserService.queryByUserId(userId);
  } else {
    throw new Error(
      'Specify either organizationId or userId query parameter to retrieve the list of organization-users',
    );
  }
};
