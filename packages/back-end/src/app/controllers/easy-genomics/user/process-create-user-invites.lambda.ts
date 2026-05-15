import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import {
  SnsProcessingEvent,
  SnsProcessingOperation,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { QueuedUserInvitationRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-invitation';
import { APIGatewayProxyResult, Handler, SQSRecord } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { UserInviteService } from '@BE/services/easy-genomics/user-invite-service';
import { UserService } from '@BE/services/easy-genomics/user-service';

const userInviteService = new UserInviteService();
const organizationService = new OrganizationService();
const userService = new UserService();

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const body = JSON.parse(sqsRecord.body);
      const snsEvent: SnsProcessingEvent = <SnsProcessingEvent>JSON.parse(body.Message);

      switch (snsEvent.Type) {
        case 'UserInvite':
          const inviteRequest: QueuedUserInvitationRequest = <QueuedUserInvitationRequest>(
            JSON.parse(JSON.stringify(snsEvent.Record))
          );
          await processUserInviteEvent(snsEvent.Operation, inviteRequest);
          break;
        default:
          console.error(`Unsupported SNS Processing Event Type: ${snsEvent.Type}`);
      }
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success' }));
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err);
  }
};

async function processUserInviteEvent(operation: SnsProcessingOperation, inviteRequest: QueuedUserInvitationRequest) {
  if (operation === 'CREATE') {
    console.log('Processing invite request: ', inviteRequest);
    try {
      const organization: Organization = await organizationService.get(inviteRequest.OrganizationId); // Throws error if not found
      const existingUser: User | undefined = (await userService.queryByEmail(inviteRequest.Email)).shift();
      if (!existingUser) {
        console.log(
          `New User to invite to Platform & Organization: Email=${inviteRequest.Email}, OrganizationId=${organization.OrganizationId}`,
        );
        // New User processing logic
        await userInviteService.inviteNewUserToOrganization(organization, inviteRequest.Email, inviteRequest.CreatedBy);
        return;
      } else {
        // Existing User processing logic
        switch (existingUser.Status) {
          case 'Invited': // Existing User's Status is still 'Invited' so resend invite via Cognito
            console.log(
              `Existing User to re-invite to Platform & Organization: Email=${existingUser.Email}, OrganizationId=${organization.OrganizationId}`,
            );
            await userInviteService.reinviteExistingUserToOrganization(
              organization,
              existingUser,
              inviteRequest.CreatedBy,
            );
            break;
          case 'Active':
            console.log(
              `Existing User to add to Organization: Email=${existingUser.Email}, OrganizationId=${organization.OrganizationId}`,
            );
            await userInviteService.addExistingUserToOrganization(organization, existingUser, inviteRequest.CreatedBy);
            break;
          default:
            throw new Error(
              `Unable to invite User to Organization "${organization.Name}": User Status is "${existingUser.Status}"`,
            );
        }
      }
    } catch (error: any) {
      console.error('Could not process request', error);
    }
  } else {
    console.error(`Unsupported SNS Processing Event Operation: ${operation}`);
  }
}
