import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  OrganizationNotFoundError,
  OrganizationUserAlreadyExistsError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { AddOrganizationUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { PlatformUserService } from '@BE/services/easy-genomics/platform-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationUserService = new OrganizationUserService();
const organizationService = new OrganizationService();
const platformUserService = new PlatformUserService();
const userService = new UserService();

// TODO: Replace the following logic and with create-user-invite API logic
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    // Post Request Body
    const request: OrganizationUser = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!AddOrganizationUserSchema.safeParse(request).success) throw new InvalidRequestError();

    // Only System Admins or Organisation Admins are allowed to add Org users
    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, request.OrganizationId))) {
      throw new UnauthorizedAccessError();
    }

    const organizationUser: OrganizationUser | void = await organizationUserService
      .get(request.OrganizationId, request.UserId)
      .catch((error: any) => {
        if (error instanceof OrganizationNotFoundError) {
          // Do nothing - allow new Organization-User access mapping to proceed.
        } else {
          throw error;
        }
      });

    if (organizationUser) {
      throw new OrganizationUserAlreadyExistsError();
    }

    // Check if Organization & User records exists
    await organizationService.get(request.OrganizationId);
    const existingUser: User = await userService.get(request.UserId);

    // Attempt to add the User to the Organization in one transaction
    if (
      await platformUserService
        .addExistingUserToOrganization(
          {
            ...existingUser,
            ModifiedAt: new Date().toISOString(),
            ModifiedBy: currentUserId,
          },
          {
            ...request,
            CreatedAt: new Date().toISOString(),
            CreatedBy: currentUserId,
          },
        )
        .catch((error: any) => {
          if (error instanceof ConditionalCheckFailedException) {
            throw new OrganizationUserAlreadyExistsError();
          } else {
            throw error;
          }
        })
    ) {
      return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
