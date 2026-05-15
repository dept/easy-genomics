import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateBulkUserInvitationRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-invitation';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import {
  CreateBulkUserInvitationRequest,
  QueuedUserInvitationRequest,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-invitation';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { SnsService } from '@BE/services/sns-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationService = new OrganizationService();
const snsService = new SnsService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    // Post Request Body
    const request: CreateBulkUserInvitationRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    // Data validation safety check
    if (!CreateBulkUserInvitationRequestSchema.safeParse(request).success) throw new InvalidRequestError();

    // Only the SystemAdmin or any User with access to the Organization is allowed access to this API
    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, request.OrganizationId))) {
      throw new UnauthorizedAccessError();
    }

    // Check if Organization record exists
    const organization: Organization = await organizationService.get(request.OrganizationId); // Throws error if not found

    await Promise.all(
      request.Emails.map(async (email: string) => {
        const record: SnsProcessingEvent = {
          Operation: 'CREATE',
          Type: 'UserInvite',
          Record: <QueuedUserInvitationRequest>{
            OrganizationId: organization.OrganizationId,
            Email: email,
            CreatedBy: currentUserId,
          },
        };
        return snsService.publish({
          TopicArn: process.env.SNS_USER_INVITE_TOPIC,
          Message: JSON.stringify(record),
          MessageGroupId: `create-user-invite-${organization.OrganizationId}`,
          MessageDeduplicationId: uuidv4(),
        });
      }),
    );

    return buildResponse(200, JSON.stringify({ Status: 'success' }), event);
  } catch (error: any) {
    console.error(error);
    return buildErrorResponse(error, event);
  }
};
