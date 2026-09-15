import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  AddLaboratoryRun,
  AddLaboratoryRunSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { associateInputsWithWorkflowTag } from '@BE/services/easy-genomics/associate-laboratory-run-workflow-tagging';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { RunCostEstimationService } from '@BE/services/easy-genomics/run-cost-estimation-service';
import { buildRunInputProfile } from '@BE/services/easy-genomics/run-input-profile-service';
import { SqsService } from '@BE/services/sqs-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import {
  calculateExpiresAtEpochSeconds,
  getRetentionMonthsOrDefault,
  isTerminalLaboratoryRunStatus,
  shouldExpireWithRetentionMonths,
} from '@BE/utils/laboratory-run-ttl-utils';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();
const dataTaggingService = new LaboratoryDataTaggingService();
const runCostEstimationService = new RunCostEstimationService();
const sqsService = new SqsService();

/**
 * Best-effort SQS publish that queues the first status check for a newly-submitted run.
 * The run is already persisted by this point; a queue outage here must never fail run
 * creation — the scheduled active-run poller will pick this run up on its next pass.
 */
async function safeQueueStatusCheck(laboratoryRun: LaboratoryRun): Promise<void> {
  const queueUrl = process.env.SQS_LABORATORY_RUN_UPDATE_QUEUE_URL;
  if (!queueUrl) return;
  try {
    const record: SnsProcessingEvent = {
      Operation: 'UPDATE',
      Type: 'LaboratoryRun',
      Record: laboratoryRun,
    };
    await sqsService.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(record),
      MessageGroupId: `update-laboratory-run-${laboratoryRun.RunId}`,
      MessageDeduplicationId: uuidv4(),
    });
  } catch (err) {
    console.warn('Failed to queue status check for newly-created run (continuing):', err);
  }
}

/**
 * Best-effort input profile + pre-run estimate. Runs after laboratoryRunService.addOrGetExisting()
 * so a timeout here cannot leave an externally-submitted run untracked.
 */
async function attachPreRunCostEstimate(
  laboratory: Laboratory,
  laboratoryRun: LaboratoryRun,
  request: AddLaboratoryRun,
): Promise<LaboratoryRun> {
  try {
    const runInputProfile = await buildRunInputProfile({
      laboratory,
      inputFileKeys: request.InputFileKeys,
      sampleSheetS3Url: request.SampleSheetS3Url,
      settings: request.Settings,
    });
    const estimate = await runCostEstimationService.estimate(laboratory, {
      platform: request.Platform,
      workflowExternalId: request.WorkflowExternalId || '',
      workflowVersionName: request.WorkflowVersionName,
      inputFileKeys: request.InputFileKeys,
      sampleSheetS3Url: request.SampleSheetS3Url,
      settings: request.Settings,
      sampleCount: runInputProfile.SampleCount,
      inputBytesTotal: runInputProfile.InputBytesTotal,
    });
    const preRunCostEstimate = runCostEstimationService.toPreRunCostEstimate(estimate);
    return await laboratoryRunService.update({
      ...laboratoryRun,
      RunInputProfile: runInputProfile,
      ...(preRunCostEstimate ? { PreRunCostEstimate: preRunCostEstimate } : {}),
      ModifiedAt: new Date().toISOString(),
      ModifiedBy: laboratoryRun.CreatedBy || 'system',
    });
  } catch (err) {
    console.warn('Failed to attach RunInputProfile / PreRunCostEstimate (continuing):', err);
    return laboratoryRun;
  }
}

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Prefer platform UserId claim (set by pre-token-generation) so run ownership matches DynamoDB User records.
    const currentUserId =
      event.requestContext.authorizer.claims.UserId || event.requestContext.authorizer.claims['cognito:username'];
    const currentUserEmail = event.requestContext.authorizer.claims.email;
    // Post Request Body
    const request: AddLaboratoryRun = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!AddLaboratoryRunSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    // Validate Laboratory exists before creating Laboratory Run
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);
    if (!laboratory) {
      throw new LaboratoryNotFoundError();
    }

    // Only available for Org Admins or Laboratory Managers and Technicians
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const createdAt = new Date();
    const isTerminalAtCreate = isTerminalLaboratoryRunStatus(request.Status);
    const retentionMonths = getRetentionMonthsOrDefault(laboratory.RunRetentionMonths);
    const laboratorioRunExpiresAt: number | undefined =
      isTerminalAtCreate && shouldExpireWithRetentionMonths(retentionMonths)
        ? calculateExpiresAtEpochSeconds(createdAt, retentionMonths)
        : undefined;

    // Persist the run first so an external platform submission is never left untracked
    // if subsequent best-effort cost estimation times out.
    let laboratoryRun: LaboratoryRun = await laboratoryRunService.addOrGetExisting(
      <LaboratoryRun>{
        LaboratoryId: laboratory.LaboratoryId,
        RunId: request.RunId,
        UserId: currentUserId,
        OrganizationId: laboratory.OrganizationId,
        RunName: request.RunName,
        ...(request.Description ? { Description: request.Description } : {}),
        Platform: request.Platform,
        PlatformApiBaseUrl: request.PlatformApiBaseUrl,
        Status: request.Status,
        Owner: currentUserEmail,
        WorkflowName: request.WorkflowName,
        WorkflowVersionName: request.WorkflowVersionName,
        WorkflowExternalId: request.WorkflowExternalId,
        InputFileKeys: request.InputFileKeys,
        ExternalRunId: request.ExternalRunId,
        InputS3Url: request.InputS3Url,
        OutputS3Url: request.OutputS3Url,
        SampleSheetS3Url: request.SampleSheetS3Url,
        Settings: JSON.stringify(request.Settings || {}),
        CreatedAt: createdAt.toISOString(),
        CreatedBy: currentUserId,
        ...(isTerminalAtCreate ? { TerminalAt: createdAt.toISOString() } : { PollStatus: 'ACTIVE' as const }),
        ...(laboratorioRunExpiresAt !== undefined ? { ExpiresAt: laboratorioRunExpiresAt } : {}),
      },
      currentUserId,
    );

    laboratoryRun = await attachPreRunCostEstimate(laboratory, laboratoryRun, request);

    // Best-effort: associate input files with a workflow tag and record this run's usage
    // history per file so the data tagging page can show "files used by workflow X" and
    // per-file analysis history. Failures here must NEVER block run creation.
    await associateInputsWithWorkflowTag({
      laboratory,
      userId: currentUserId,
      run: laboratoryRun,
      tagging: dataTaggingService,
    });

    if (laboratoryRun.ExternalRunId) {
      await safeQueueStatusCheck(laboratoryRun);
    }

    return buildResponse(200, JSON.stringify(laboratoryRun), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
