import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryDeleteFailedError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { SnsService } from '@BE/services/sns-service';
import { SsmService } from '@BE/services/ssm-service';
import { validateOrganizationAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const laboratoryUserService = new LaboratoryUserService();
const laboratoryRunService = new LaboratoryRunService();
const snsService = new SnsService();
const ssmService = new SsmService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    // Lookup by LaboratoryId to confirm existence before deletion
    const existingLaboratory: Laboratory = await laboratoryService.queryByLaboratoryId(id);

    // Only Organisation Admins are allowed delete laboratories
    if (!validateOrganizationAdminAccess(event, existingLaboratory.OrganizationId)) {
      throw new UnauthorizedAccessError();
    }

    // Publish FIFO asynchronous events to delete the Laboratory's Users, Runs and finally the Laboratory
    await publishDeleteLaboratoryUsers(existingLaboratory.LaboratoryId);
    await publishDeleteLaboratoryRuns(existingLaboratory.LaboratoryId);
    const isDeleted: boolean = await laboratoryService.delete(existingLaboratory);

    if (!isDeleted) {
      throw new LaboratoryDeleteFailedError();
    }

    await ssmService
      .deleteParameter({
        Name: `/easy-genomics/organization/${existingLaboratory.OrganizationId}/laboratory/${existingLaboratory.LaboratoryId}/nf-access-token`,
      })
      .catch(() => {});

    return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

/**
 * Publishes SNS notification messages to delete the Laboratory's Users
 * @param laboratoryId
 */
async function publishDeleteLaboratoryUsers(laboratoryId: string): Promise<void> {
  const laboratoryUsers: LaboratoryUser[] = await laboratoryUserService.queryByLaboratoryId(laboratoryId);

  await Promise.all(
    laboratoryUsers.map(async (laboratoryUser: LaboratoryUser) => {
      const record: SnsProcessingEvent = {
        Operation: 'DELETE',
        Type: 'LaboratoryUser',
        Record: laboratoryUser,
      };
      return snsService.publish({
        TopicArn: process.env.SNS_LABORATORY_DELETION_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `delete-laboratory-${laboratoryId}`,
        MessageDeduplicationId: uuidv4(),
      });
    }),
  );
}

/**
 * Publishes SNS notification messages to delete the Laboratory's Runs
 * @param laboratoryId
 */
async function publishDeleteLaboratoryRuns(laboratoryId: string): Promise<void> {
  const laboratoryRuns: LaboratoryRun[] = await laboratoryRunService.queryByLaboratoryId(laboratoryId);

  await Promise.all(
    laboratoryRuns.map(async (laboratoryRun: LaboratoryRun) => {
      const record: SnsProcessingEvent = {
        Operation: 'DELETE',
        Type: 'LaboratoryRun',
        Record: laboratoryRun,
      };
      return snsService.publish({
        TopicArn: process.env.SNS_LABORATORY_DELETION_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `delete-laboratory-${laboratoryId}`,
        MessageDeduplicationId: uuidv4(),
      });
    }),
  );
}
