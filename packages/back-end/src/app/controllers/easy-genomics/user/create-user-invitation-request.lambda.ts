import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { CreateUserInvitationRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-invitation';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { CreateUserInvitationRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-invitation';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { UserInviteService } from '@BE/services/easy-genomics/user-invite-service';
import { UserService } from '@BE/services/easy-genomics/user-service';

const organizationService = new OrganizationService();
const userInviteService = new UserInviteService();
const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    // Post Request Body
    const request: CreateUserInvitationRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    // Data validation safety check
    if (!CreateUserInvitationRequestSchema.safeParse(request).success) throw new Error('Invalid request');

    // Check if Organization & User records exists
    const organization: Organization = await organizationService.get(request.OrganizationId); // Throws error if not found
    const existingUser: User | undefined = (await userService.queryByEmail(request.Email)).shift();

    if (!existingUser) {
      console.log(
        `New User to invite to Platform & Organization: Email=${request.Email}, OrganizationId=${organization.OrganizationId}`,
      );
      // New User processing logic
      await userInviteService.inviteNewUserToOrganization(organization, request.Email, currentUserId);
      return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
    } else {
      // Existing User processing logic
      switch (existingUser.Status) {
        case 'Invited': // Existing User's Status is still 'Invited' so resend invite via Cognito
          console.log(
            `Existing User to re-invite to Platform & Organization: Email=${existingUser.Email}, OrganizationId=${organization.OrganizationId}`,
          );
          await userInviteService.reinviteExistingUserToOrganization(organization, existingUser, currentUserId);
          return buildResponse(200, JSON.stringify({ Status: 'Re-inviting' }), event);
        case 'Active':
          console.log(
            `Existing User to add to Organization: Email=${existingUser.Email}, OrganizationId=${organization.OrganizationId}`,
          );
          await userInviteService.addExistingUserToOrganization(organization, existingUser, currentUserId);
          return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
        default:
          throw new Error(
            `Unable to invite User to Organization "${organization.Name}": User Status is "${existingUser.Status}"`,
          );
      }
    }
  } catch (error: any) {
    console.error(error);
    return buildErrorResponse(error, event);
  }
};
