import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RemoveOrganizationUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { PlatformUserService } from '@BE/services/easy-genomics/platform-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationUserService = new OrganizationUserService();
const platformUserService = new PlatformUserService();
const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    // Post Request Body
    const request: OrganizationUser = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!RemoveOrganizationUserSchema.safeParse(request).success) throw new InvalidRequestError();

    // Only System Admins or Organisation Admins are allowed to remove Org users
    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, request.OrganizationId))) {
      throw new UnauthorizedAccessError();
    }

    // Lookup by OrganizationId & UserId to confirm existence before updating
    const organizationUser: OrganizationUser = await organizationUserService.get(
      request.OrganizationId,
      request.UserId,
    );
    const existingUser: User = await userService.get(request.UserId);

    const response: boolean = await platformUserService.removeExistingUserFromOrganization(
      {
        ...existingUser,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: currentUserId,
      },
      organizationUser,
    );
    if (response) {
      return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
