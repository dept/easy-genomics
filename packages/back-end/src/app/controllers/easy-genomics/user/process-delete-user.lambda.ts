import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import {
  SnsProcessingEvent,
  SnsProcessingOperation,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, Handler, SQSRecord } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';

const laboratoryUserService = new LaboratoryUserService();
const organizationUserService = new OrganizationUserService();

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const body = JSON.parse(sqsRecord.body);
      const snsEvent: SnsProcessingEvent = <SnsProcessingEvent>JSON.parse(body.Message);

      switch (snsEvent.Type) {
        case 'LaboratoryUser':
          const laboratoryUser: LaboratoryUser = <LaboratoryUser>JSON.parse(JSON.stringify(snsEvent.Record));
          await processDeleteLaboratoryUserEvent(snsEvent.Operation, laboratoryUser);
          break;
        case 'OrganizationUser':
          const organizationUser: OrganizationUser = <OrganizationUser>JSON.parse(JSON.stringify(snsEvent.Record));
          await processDeleteOrganizationUserEvent(snsEvent.Operation, organizationUser);
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
    await organizationUserService.delete(organizationUser);
  } else {
    console.error(`Unsupported SNS Processing Event Operation: ${operation}`);
  }
}

async function processDeleteLaboratoryUserEvent(operation: SnsProcessingOperation, laboratoryUser: LaboratoryUser) {
  if (operation === 'DELETE') {
    console.log('Processing LaboratoryUser Deletion: ', laboratoryUser);
    await laboratoryUserService.delete(laboratoryUser);
  } else {
    console.error(`Unsupported SNS Processing Event Operation: ${operation}`);
  }
}
