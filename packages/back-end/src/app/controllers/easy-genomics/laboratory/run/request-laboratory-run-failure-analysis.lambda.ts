import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryFailureAnalysisDisabledError,
  LaboratoryLlmConfigurationInvalidError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SqsService } from '@BE/services/sqs-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { assertLaboratoryLlmConfigured } from '@BE/utils/laboratory-llm-config-utils';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();
const sqsService = new SqsService();

/** Analysis fields this endpoint writes, and must be able to undo. */
const ANALYSIS_FIELDS = [
  'AnalysisStatus',
  'AnalysisRequestedAt',
  'AnalysisRequestedBy',
  'AnalysisErrorCode',
  'AnalysisErrorMessage',
] as const;

/**
 * Revert the analysis fields to their pre-request values. Fields the run did not
 * have are REMOVEd rather than left behind, so a run that had never been analysed
 * goes back to exactly that — not to a half-written `Queued`.
 */
async function restoreAnalysisFields(previous: LaboratoryRun, modifiedBy: string): Promise<void> {
  const absentBefore = ANALYSIS_FIELDS.filter((field) => previous[field] === undefined);
  await laboratoryRunService.updateWithAttributeRemoval(
    { ...previous, ModifiedAt: new Date().toISOString(), ModifiedBy: modifiedBy },
    [...absentBefore],
  );
}

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (!laboratoryId) throw new InvalidRequestError('Missing laboratoryId');

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

    const request = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const runId: string = request?.LaboratoryRunId || '';
    if (!runId) throw new InvalidRequestError('Missing LaboratoryRunId');

    const run = await laboratoryRunService.queryByRunId(runId);
    if (run.LaboratoryId !== laboratoryId) throw new InvalidRequestError('Run does not belong to this Laboratory');
    if (run.Status?.toUpperCase() !== 'FAILED') {
      throw new InvalidRequestError('AI failure analysis is only available for failed runs');
    }

    // Master switch: analysis is manual-trigger-only, and an admin/lab-manager
    // can turn it off for the whole lab. `!== false` so labs that predate the
    // field keep today's behaviour with no data migration.
    if (laboratory.FailureAnalysisEnabled === false) {
      throw new LaboratoryFailureAnalysisDisabledError();
    }

    // Config errors are knowable before any work starts, so they are reported
    // synchronously rather than through the async status field.
    const configError = assertLaboratoryLlmConfigured(laboratory, run.Platform);
    if (configError) throw new LaboratoryLlmConfigurationInvalidError(configError);

    const requestedAt = new Date().toISOString();
    await laboratoryRunService.updateWithAttributeRemoval(
      {
        ...run,
        AnalysisStatus: 'Queued',
        AnalysisRequestedAt: requestedAt,
        AnalysisRequestedBy: event.requestContext.authorizer.claims['cognito:username'],
        ModifiedAt: requestedAt,
        ModifiedBy: event.requestContext.authorizer.claims['cognito:username'],
      },
      ['AnalysisErrorCode', 'AnalysisErrorMessage'],
    );

    const message: SnsProcessingEvent = { Operation: 'UPDATE', Type: 'LaboratoryRun', Record: run, Trigger: 'Manual' };
    try {
      await sqsService.sendMessage({
        QueueUrl: process.env.SQS_LABORATORY_RUN_FAILURE_CLASSIFICATION_QUEUE_URL,
        MessageBody: JSON.stringify(message),
        MessageGroupId: `classify-laboratory-run-${run.RunId}`,
        MessageDeduplicationId: uuidv4(),
      });
    } catch (enqueueError: any) {
      // The `Queued` write above has already landed. Leaving it strands the run:
      // no consumer will ever pick it up, and the run page renders "Analysing…"
      // instead of a clickable button, so the user can never retry. Put the
      // analysis fields back exactly as they were, then report the failure.
      await restoreAnalysisFields(run, event.requestContext.authorizer.claims['cognito:username']);
      throw enqueueError;
    }

    return buildResponse(200, JSON.stringify({ Status: 'Queued' }), event);
  } catch (err: any) {
    return buildErrorResponse(err, event);
  }
};
