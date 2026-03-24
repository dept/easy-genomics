import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
  UserDeleteFailedError,
  UserNotFoundError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyWithCognitoAuthorizerEvent, APIGatewayProxyResult, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { CognitoIdpService } from '@BE/services/cognito-idp-service';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { SnsService } from '@BE/services/sns-service';
import { validateSystemAdminAccess } from '@BE/utils/auth-utils';

const cognitoIdpService = new CognitoIdpService({ userPoolId: process.env.COGNITO_USER_POOL_ID });
const userService: UserService = new UserService();
const snsService: SnsService = new SnsService();
const laboratoryUserService: LaboratoryUserService = new LaboratoryUserService();
const organizationUserService: OrganizationUserService = new OrganizationUserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Only system admins can delete users
    if (!validateSystemAdminAccess(event)) {
      throw new UnauthorizedAccessError();
    }

    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    const user: User | undefined = await userService.get(id);

    if (!user) {
      console.log(user);
      throw new UserNotFoundError(`'${id}' not found`);
    }

    try {
      // Remove Cognito User Account
      await cognitoIdpService.adminDeleteUser(user.UserId);
    } catch (err: any) {
      console.error(err);
      throw new UserDeleteFailedError('could not remove user from cognito');
    }

    // Cleanup user in database
    await userService.delete(user);

    // Publish FIFO asynchronous events to delete the Laboratory and organization Users
    await publishDeleteOrganizationUsers(user.UserId);
    await publishDeleteLaboratoryUsers(user.UserId);

    return buildResponse(200, JSON.stringify({ Status: 'success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

/**
 * Publishes SNS notification messages to delete the Laboratory's Users
 * @param laboratoryId
 */
async function publishDeleteLaboratoryUsers(userId: string): Promise<void> {
  const laboratoryUsers: LaboratoryUser[] = await laboratoryUserService.queryByUserId(userId);

  await Promise.all(
    laboratoryUsers.map(async (laboratoryUser: LaboratoryUser) => {
      const record: SnsProcessingEvent = {
        Operation: 'DELETE',
        Type: 'LaboratoryUser',
        Record: laboratoryUser,
      };
      return snsService.publish({
        TopicArn: process.env.SNS_USER_DELETION_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `delete-user-${userId}`,
        MessageDeduplicationId: uuidv4(),
      });
    }),
  );
}

/**
 * Publishes SNS notification messages to delete the Organization Users
 * @param organizationId
 */
async function publishDeleteOrganizationUsers(userId: string): Promise<void> {
  const organizationUsers: OrganizationUser[] = await organizationUserService.queryByUserId(userId);

  await Promise.all(
    organizationUsers.map(async (organizationUser: OrganizationUser) => {
      const record: SnsProcessingEvent = {
        Operation: 'DELETE',
        Type: 'OrganizationUser',
        Record: organizationUser,
      };
      return snsService.publish({
        TopicArn: process.env.SNS_USER_DELETION_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `delete-user-${userId}`,
        MessageDeduplicationId: uuidv4(),
      });
    }),
  );
}
