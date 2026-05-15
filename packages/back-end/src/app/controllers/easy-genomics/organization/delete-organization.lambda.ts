import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  OrganizationDeleteFailedError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { SnsService } from '@BE/services/sns-service';
import { validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationService = new OrganizationService();
const organizationUserService = new OrganizationUserService();
const laboratoryService = new LaboratoryService();
const snsService = new SnsService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    if (!validateSystemAdminAccess(event)) {
      throw new UnauthorizedAccessError();
    }
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    // Lookup by OrganizationId to confirm existence before deletion
    const existing: Organization = await organizationService.get(id);

    // Publish FIFO asynchronous events to delete the Organization's associated Users, Labs, and finally the Organization
    await publishDeleteOrganizationUsers(existing.OrganizationId);
    await publishDeleteOrganizationLabs(existing.OrganizationId);
    const isDeleted: boolean = await organizationService.delete(existing);

    if (!isDeleted) {
      throw new OrganizationDeleteFailedError();
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

/**
 * Publishes SNS notification messages to delete the Organization Users
 * @param organizationId
 */
async function publishDeleteOrganizationUsers(organizationId: string): Promise<void> {
  const organizationUsers: OrganizationUser[] = await organizationUserService.queryByOrganizationId(organizationId);

  await Promise.all(
    organizationUsers.map(async (organizationUser: OrganizationUser) => {
      const record: SnsProcessingEvent = {
        Operation: 'DELETE',
        Type: 'OrganizationUser',
        Record: organizationUser,
      };
      return snsService.publish({
        TopicArn: process.env.SNS_ORGANIZATION_DELETION_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `delete-organization-${organizationId}`,
        MessageDeduplicationId: uuidv4(),
      });
    }),
  );
}

/**
 * Publishes SNS notification messages to delete the Organization Laboratories
 * @param organizationId
 */
async function publishDeleteOrganizationLabs(organizationId: string): Promise<void> {
  const laboratories: Laboratory[] = await laboratoryService.queryByOrganizationId(organizationId);

  await Promise.all(
    laboratories.map(async (laboratory: Laboratory) => {
      const record: SnsProcessingEvent = {
        Operation: 'DELETE',
        Type: 'Laboratory',
        Record: laboratory,
      };
      return snsService.publish({
        TopicArn: process.env.SNS_ORGANIZATION_DELETION_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `delete-organization-${organizationId}`,
        MessageDeduplicationId: uuidv4(),
      });
    }),
  );
}
