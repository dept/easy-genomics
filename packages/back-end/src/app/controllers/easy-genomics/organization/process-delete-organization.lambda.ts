import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import {
  SnsProcessingEvent,
  SnsProcessingOperation,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, Handler, SQSRecord } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { PlatformUserService } from '@BE/services/easy-genomics/platform-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';

const laboratoryService = new LaboratoryService();
const platformUserService = new PlatformUserService();
const userService = new UserService();

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const body = JSON.parse(sqsRecord.body);
      const snsEvent: SnsProcessingEvent = <SnsProcessingEvent>JSON.parse(body.Message);

      switch (snsEvent.Type) {
        case 'LaboratoryUser':
          // LaboratoryUser records are deleted as part of the OrganizationUser deletion transaction for performance
          break;
        case 'Laboratory':
          const laboratory: Laboratory = <Laboratory>JSON.parse(JSON.stringify(snsEvent.Record));
          await processDeleteLaboratoryEvent(snsEvent.Operation, laboratory);
          break;
        case 'OrganizationUser':
          const organizationUser: OrganizationUser = <OrganizationUser>JSON.parse(JSON.stringify(snsEvent.Record));
          await processDeleteOrganizationUserEvent(snsEvent.Operation, organizationUser);
          break;
        case 'Organization':
          // Organization record is deleted by the event publisher 'delete-organization' API for performance
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

async function processDeleteOrganizationUserEvent(
  operation: SnsProcessingOperation,
  organizationUser: OrganizationUser,
) {
  if (operation === 'DELETE') {
    console.log('Processing OrganizationUser Deletion: ', organizationUser);
    const existingUser: User = await userService.get(organizationUser.UserId);
    await platformUserService.removeExistingUserFromOrganization(
      {
        ...existingUser,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: 'SNS/SQS Processing',
      },
      organizationUser,
    );
  } else {
    console.error(`Unsupported SNS Processing Event Operation: ${operation}`);
  }
}

async function processDeleteLaboratoryEvent(operation: SnsProcessingOperation, laboratory: Laboratory) {
  if (operation === 'DELETE') {
    console.log('Processing Organization Laboratory Deletion: ', laboratory);
    await laboratoryService.delete(laboratory);
  } else {
    console.error(`Unsupported SNS Processing Event Operation: ${operation}`);
  }
}
