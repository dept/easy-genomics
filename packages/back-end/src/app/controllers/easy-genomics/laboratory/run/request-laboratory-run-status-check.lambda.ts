import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SnsService } from '@BE/services/sns-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();
const snsService = new SnsService();

const TERMINAL_STATUSES = ['FAILED', 'SUCCEEDED', 'CANCELLED', 'COMPLETED', 'DELETED'];

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (!laboratoryId) throw new InvalidRequestError('Missing laboratoryId');

    // Authorization: check lab exists and user has access
    const laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) throw new LaboratoryNotFoundError();
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    // Parse runIds from body (required)
    let runIds: string[] | undefined = undefined;
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        if (Array.isArray(body.runIds)) {
          runIds = body.runIds;
        }
      } catch (e) {
        // Ignore parse error, treat as no runIds
      }
    }
    if (!runIds || runIds.length === 0) {
      throw new InvalidRequestError('No runIds provided');
    }

    // For each runId, fetch and process if not terminal
    const runsToProcess: LaboratoryRun[] = [];
    for (const runId of runIds) {
      try {
        const run = await laboratoryRunService.queryByRunId(runId);
        if (run.LaboratoryId !== laboratoryId || TERMINAL_STATUSES.includes(run.Status)) {
          continue;
        }
        runsToProcess.push(run);
      } catch (e) {
        // Optionally log missing runs, but skip
        continue;
      }
    }

    // Publish SNS event for each run to process
    const publishPromises = runsToProcess.map((run) => {
      const record: SnsProcessingEvent = {
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: run,
      };
      return snsService.publish({
        TopicArn: process.env.SNS_LABORATORY_RUN_UPDATE_TOPIC,
        Message: JSON.stringify(record),
        MessageGroupId: `update-laboratory-run-${run.RunId}`,
        MessageDeduplicationId: uuidv4(),
      });
    });

    await Promise.all(publishPromises);

    return buildResponse(200, JSON.stringify({ Status: 'Requested', Count: publishPromises.length }), event);
  } catch (err: any) {
    return buildErrorResponse(err, event);
  }
};
