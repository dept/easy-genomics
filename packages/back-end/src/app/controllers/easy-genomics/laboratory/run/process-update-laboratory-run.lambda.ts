import { GetRunCommandInput } from '@aws-sdk/client-omics';
import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { LaboratoryAccessTokenUnavailableError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  SnsProcessingEvent,
  SnsProcessingOperation,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import {
  DescribeWorkflowResponse,
  WorkflowProgressResponse,
} from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
import { APIGatewayProxyResult, Handler, SQSRecord } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { captureRunCostOutcome } from '@BE/services/easy-genomics/run-cost-capture-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import { SqsService } from '@BE/services/sqs-service';
import { SsmService } from '@BE/services/ssm-service';
import {
  calculateExpiresAtEpochSeconds,
  getRetentionMonthsOrDefault,
  getTerminalAtIsoString,
  isTerminalLaboratoryRunStatus,
  shouldExpireWithRetentionMonths,
} from '@BE/utils/laboratory-run-ttl-utils';
import { aggregateTaskProgress, OmicsTaskProgress } from '@BE/utils/omics-run-progress-utils';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';
import { aggregateSeqeraProgress } from '@BE/utils/seqera-run-progress-utils';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const laboratoryDataTaggingService = new LaboratoryDataTaggingService();
const sqsService = new SqsService();
const ssmService = new SsmService();

/**
 * Best-effort platform cost capture. Must never break the status-check pipeline.
 *
 * HealthOmics cost uses paginated ListRunTasks; large runs can take well over the
 * Lambda timeout (observed: 5k+ tasks / ~2min). Cap wait time so status/notify
 * writes always complete; uncaptured cost can be healed by process-sync-run-costs.
 */
const COST_CAPTURE_BUDGET_MS = 8_000;

async function safeCaptureRunCost(run: LaboratoryRun): Promise<LaboratoryRun['RunCostOutcome'] | undefined> {
  if (run.RunCostOutcome?.CostCapturedAt) return run.RunCostOutcome;
  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      captureRunCostOutcome(run),
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(
            `Cost capture timed out after ${COST_CAPTURE_BUDGET_MS}ms for RunId=${run.RunId} (continuing without cost)`,
          );
          resolve(undefined);
        }, COST_CAPTURE_BUDGET_MS);
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  } catch (err) {
    console.warn(`Failed to capture run cost for RunId=${run.RunId} (continuing):`, err);
    return undefined;
  }
}

/**
 * Best-effort SQS publish that hands off a freshly-failed run to the
 * classification pipeline. Failures here are swallowed because classification
 * is a downstream enhancement — the status-check pipeline must never break if
 * the queue is misconfigured or SQS is temporarily unavailable.
 */
async function safePublishForClassification(run: LaboratoryRun): Promise<void> {
  const queueUrl = process.env.SQS_LABORATORY_RUN_FAILURE_CLASSIFICATION_QUEUE_URL;
  if (!queueUrl) return;
  try {
    const record: SnsProcessingEvent = {
      Operation: 'UPDATE',
      Type: 'LaboratoryRun',
      Record: run,
    };
    await sqsService.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(record),
      MessageGroupId: `classify-laboratory-run-${run.RunId}`,
      MessageDeduplicationId: uuidv4(),
    });
  } catch (err) {
    console.warn('Failed to publish FAILED run to classification queue (continuing):', err);
  }
}

/**
 * Best-effort SQS publish that hands a freshly-terminal run off to the notification sender.
 * Only called when `markTerminalNotified` won its conditional write — see that method's
 * docstring for why this closes the duplicate-status-check race.
 *
 * Returns whether the publish actually succeeded so the caller can compensate: `markTerminalNotified`
 * already committed NotifiedAt and removed PollStatus, so a swallowed failure here would otherwise
 * drop the notification permanently — nothing else re-checks a run once it looks notified.
 */
async function safePublishForNotification(run: LaboratoryRun): Promise<boolean> {
  const queueUrl = process.env.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL;
  if (!queueUrl) {
    console.warn(`SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL not configured, skipping notify for RunId=${run.RunId}`);
    return false;
  }
  try {
    const record: SnsProcessingEvent = {
      Operation: 'UPDATE',
      Type: 'LaboratoryRun',
      Record: run,
    };
    await sqsService.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(record),
      MessageGroupId: `notify-laboratory-run-${run.RunId}`,
      MessageDeduplicationId: uuidv4(),
    });
    return true;
  } catch (err) {
    console.warn('Failed to publish terminal run to notification queue (continuing):', err);
    return false;
  }
}

/**
 * Reverts a winning `markTerminalNotified` conditional write after its notification publish
 * failed: removes `NotifiedAt` and restores `PollStatus: 'ACTIVE'` so the run re-enters the
 * `PollStatus_Index` poller and the backfill branch above picks it up for another notify attempt.
 */
async function compensateFailedNotification(run: LaboratoryRun): Promise<void> {
  try {
    await laboratoryRunService.updateWithAttributeRemoval(
      {
        ...run,
        PollStatus: 'ACTIVE',
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: 'Status Check',
      },
      ['NotifiedAt'],
    );
  } catch (err) {
    console.error(`Failed to compensate unpublished notification for RunId=${run.RunId}:`, err);
  }
}

async function publishForNotificationWithCompensation(run: LaboratoryRun): Promise<void> {
  const published = await safePublishForNotification(run);
  if (!published) {
    await compensateFailedNotification(run);
  }
}

/**
 * Best-effort mirror of a run's ExpiresAt into each input file's `LaboratoryRunUsages` entry.
 * Logs and swallows so tagging-side failures never break the status-check pipeline.
 */
async function safePropagateExpiresAt(
  laboratory: Laboratory | undefined,
  run: LaboratoryRun,
  expiresAt: number | undefined,
): Promise<void> {
  if (expiresAt === undefined) return;
  if (!laboratory?.S3Bucket) return;
  const keys = run.InputFileKeys || [];
  if (!keys.length) return;
  try {
    await laboratoryDataTaggingService.updateRunUsageExpiresAt(
      laboratory,
      laboratory.S3Bucket,
      run.RunId,
      keys,
      expiresAt,
    );
  } catch (err) {
    console.warn('Failed to propagate ExpiresAt to LaboratoryRunUsages (continuing):', err);
  }
}

export const handler: Handler = async (event: SQSEvent, context): Promise<APIGatewayProxyResult> => {
  // Cost capture may leave paginated Omics ListRunTasks requests in flight after we
  // abandon them via Promise.race; do not wait for the empty event loop or those
  // requests will hold the invocation until the Lambda timeout and redrive SQS.
  if (context && typeof context === 'object') {
    (context as { callbackWaitsForEmptyEventLoop?: boolean }).callbackWaitsForEmptyEventLoop = false;
  }
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const snsEvent: SnsProcessingEvent = parseSqsJsonBody<SnsProcessingEvent>(sqsRecord.body);

      switch (snsEvent.Type) {
        case 'LaboratoryRun':
          const laboratoryRun: LaboratoryRun = <LaboratoryRun>JSON.parse(JSON.stringify(snsEvent.Record));
          await processStatusCheckEvent(snsEvent.Operation, laboratoryRun);
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

/**
 * Platform-agnostic snapshot of a run fetched from its underlying platform.
 * `durationSeconds` is the actual execution duration as reported by the platform
 * (Seqera exposes it directly; for AWS HealthOmics it is computed from stop - start
 * so the rest of the system never has to reason about timestamps).
 */
type PlatformRunSnapshot = {
  status: string;
  durationSeconds?: number;
  failureReason?: string;
  // Human-readable failure detail kept separate from the machine-code `failureReason`:
  // HealthOmics surfaces it as `statusMessage`, Seqera as `workflow.errorReport`.
  statusMessage?: string;
  errorReport?: string;
  progress?: OmicsTaskProgress;
};

function toMsIfPresent(value: Date | string | undefined): number | undefined {
  if (!value) return undefined;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : undefined;
}

function progressFieldsFromSnapshot(progress: OmicsTaskProgress | undefined): Partial<LaboratoryRun> {
  if (!progress) return {};
  return {
    ProgressPercent: progress.percent,
    TasksTotal: progress.tasksTotal,
    TasksCompleted: progress.tasksCompleted,
    TasksRunning: progress.tasksRunning,
    TasksFailed: progress.tasksFailed,
  };
}

function hasProgressChanged(existingRun: LaboratoryRun, progress: OmicsTaskProgress | undefined): boolean {
  if (!progress) return false;
  return (
    existingRun.ProgressPercent !== progress.percent ||
    existingRun.TasksTotal !== progress.tasksTotal ||
    existingRun.TasksCompleted !== progress.tasksCompleted ||
    existingRun.TasksRunning !== progress.tasksRunning ||
    existingRun.TasksFailed !== progress.tasksFailed
  );
}

const LABORATORY_RUN_PROGRESS_ATTRIBUTES = [
  'ProgressPercent',
  'TasksTotal',
  'TasksCompleted',
  'TasksRunning',
  'TasksFailed',
] as const;

/** Merge existing run with a progress snapshot for persistence; strip progress attrs when terminal. */
function buildProgressUpdate(
  existingRun: LaboratoryRun,
  progress: OmicsTaskProgress | undefined,
  clearProgressOnTerminal: boolean,
): { update: LaboratoryRun; remove: string[] } {
  if (clearProgressOnTerminal) {
    return {
      update: { ...existingRun },
      remove: [...LABORATORY_RUN_PROGRESS_ATTRIBUTES],
    };
  }
  return {
    update: {
      ...existingRun,
      ...progressFieldsFromSnapshot(progress),
    },
    remove: [],
  };
}

export async function processStatusCheckEvent(operation: SnsProcessingOperation, laboratoryRun: LaboratoryRun) {
  if (operation === 'UPDATE') {
    console.log('Processing LaboratoryRun Status Update: ', laboratoryRun);
    const existingRun: LaboratoryRun = await laboratoryRunService.queryByRunId(laboratoryRun.RunId);
    const laboratory: Laboratory | undefined = await laboratoryService.queryByLaboratoryId(existingRun.LaboratoryId);
    const retentionMonths = getRetentionMonthsOrDefault(laboratory?.RunRetentionMonths);

    if (!existingRun.ExternalRunId) {
      console.log('Missing ExternalRunID from laboratory run: skipping');
      return false;
    }

    const isAlreadyTerminal = isTerminalLaboratoryRunStatus(existingRun.Status);
    const missingTerminalAt = existingRun.TerminalAt == null;
    const missingExpiresAt = existingRun.ExpiresAt == null && shouldExpireWithRetentionMonths(retentionMonths);
    const missingDuration = existingRun.RunDurationSeconds == null;
    const missingNotification = existingRun.NotifiedAt == null;

    // Backfill branch: run is already terminal but missing one or more of
    // TerminalAt / ExpiresAt / RunDurationSeconds / RunCostOutcome / NotifiedAt. Fetch platform
    // data once so we can heal historical rows without waiting for another status transition.
    // The NotifiedAt case closes a rare gap: if the status-change branch below's `update()` call
    // previously succeeded but its subsequent `markTerminalNotified()` call then failed with a
    // transient (non-conditional) error, `existingRun.Status` is already terminal on SQS retry,
    // so that branch never runs again and the run would otherwise never get notified. The
    // poller's routine re-enqueue of this already-terminal-but-unnotified run lands here
    // instead, giving notification another chance.
    const missingCost = existingRun.RunCostOutcome?.CostCapturedAt == null;
    if (
      isAlreadyTerminal &&
      (missingTerminalAt || missingExpiresAt || missingDuration || missingCost || missingNotification)
    ) {
      const now = new Date();
      const terminalAtIso = getTerminalAtIsoString(existingRun, now);

      let snapshot: PlatformRunSnapshot | undefined;
      if (missingDuration) {
        try {
          snapshot = await fetchPlatformRunSnapshot(existingRun);
        } catch (err) {
          // Backfill is best-effort; don't fail the status-check pipeline if the platform
          // call fails (e.g. run was deleted on the platform side).
          console.warn(`Runtime backfill failed for RunId=${existingRun.RunId}:`, err);
        }
      }

      const backfilledExpiresAt = missingExpiresAt
        ? calculateExpiresAtEpochSeconds(new Date(terminalAtIso), retentionMonths)
        : undefined;

      // Persist terminal metadata / duration before cost capture so a slow
      // ListRunTasks cannot block notification or leave ExpiresAt unset.
      const updated = await laboratoryRunService.update({
        ...existingRun,
        ...(missingTerminalAt ? { TerminalAt: terminalAtIso } : {}),
        ...(backfilledExpiresAt !== undefined ? { ExpiresAt: backfilledExpiresAt } : {}),
        ...(snapshot?.durationSeconds != null && existingRun.RunDurationSeconds == null
          ? { RunDurationSeconds: snapshot.durationSeconds }
          : {}),
        ModifiedAt: now.toISOString(),
        ModifiedBy: 'Status Check',
      });
      void updated;
      await safePropagateExpiresAt(laboratory, updated, backfilledExpiresAt);

      if (missingNotification) {
        const { published, run: notifiedRun } = await laboratoryRunService.markTerminalNotified({
          LaboratoryId: updated.LaboratoryId,
          RunId: updated.RunId,
          ModifiedAt: now.toISOString(),
          ModifiedBy: 'Status Check',
        });
        if (published) {
          await publishForNotificationWithCompensation(notifiedRun);
        }
      }

      if (missingCost) {
        const costOutcome = await safeCaptureRunCost(updated);
        if (costOutcome) {
          await laboratoryRunService.update({
            ...updated,
            RunCostOutcome: costOutcome,
            ModifiedAt: new Date().toISOString(),
            ModifiedBy: 'Status Check',
          });
        }
      }

      return true;
    }

    const snapshot: PlatformRunSnapshot = { status: existingRun.Status };

    if (existingRun.Platform === 'AWS HealthOmics' || existingRun.Platform === 'Seqera Cloud') {
      Object.assign(snapshot, await fetchPlatformRunSnapshot(existingRun));
    }

    const currentStatus = snapshot.status || existingRun.Status;

    // Has status changed?
    if (existingRun.Status.toUpperCase() != currentStatus.toUpperCase()) {
      console.log('status change', existingRun.Status, currentStatus);

      const now = new Date();
      const newStatusNormalized = currentStatus.toUpperCase();
      const nextStatusTerminal = isTerminalLaboratoryRunStatus(newStatusNormalized);
      const terminalAtIso = nextStatusTerminal ? getTerminalAtIsoString(existingRun, now) : undefined;
      const shouldSetTerminalAt = nextStatusTerminal && existingRun.TerminalAt == null && terminalAtIso != null;
      const shouldSetExpiresAt =
        nextStatusTerminal &&
        existingRun.ExpiresAt == null &&
        shouldExpireWithRetentionMonths(retentionMonths) &&
        terminalAtIso != null;

      const newExpiresAt =
        shouldSetExpiresAt && terminalAtIso
          ? calculateExpiresAtEpochSeconds(new Date(terminalAtIso), retentionMonths)
          : undefined;

      const { update: progressUpdate, remove: progressRemove } = buildProgressUpdate(
        existingRun,
        snapshot.progress,
        nextStatusTerminal,
      );

      // Write status (and terminal metadata) before cost capture. Large Omics runs
      // can spend minutes in ListRunTasks; blocking here left Status stuck at RUNNING
      // until the Lambda timed out and SQS retried forever.
      laboratoryRun = await laboratoryRunService.updateWithAttributeRemoval(
        {
          ...progressUpdate,
          Status: newStatusNormalized,
          ...(shouldSetTerminalAt ? { TerminalAt: terminalAtIso } : {}),
          ...(newExpiresAt !== undefined ? { ExpiresAt: newExpiresAt } : {}),
          ...(snapshot.durationSeconds != null && existingRun.RunDurationSeconds == null
            ? { RunDurationSeconds: snapshot.durationSeconds }
            : {}),
          ...(newStatusNormalized === 'FAILED' && snapshot.failureReason && existingRun.FailureReason == null
            ? { FailureReason: snapshot.failureReason }
            : {}),
          ...(newStatusNormalized === 'FAILED' && snapshot.statusMessage && existingRun.FailureReason == null
            ? { FailureStatusMessage: snapshot.statusMessage }
            : {}),
          ...(newStatusNormalized === 'FAILED' && snapshot.errorReport && existingRun.FailureReason == null
            ? { FailureErrorReport: snapshot.errorReport }
            : {}),
          ModifiedAt: now.toISOString(),
          ModifiedBy: 'Status Check',
        },
        progressRemove,
      );
      await safePropagateExpiresAt(laboratory, laboratoryRun, newExpiresAt);
      if (newStatusNormalized === 'FAILED' && existingRun.FailureOwner == null) {
        await safePublishForClassification(laboratoryRun);
      }
      if (nextStatusTerminal) {
        const { published, run: notifiedRun } = await laboratoryRunService.markTerminalNotified({
          LaboratoryId: laboratoryRun.LaboratoryId,
          RunId: laboratoryRun.RunId,
          ModifiedAt: now.toISOString(),
          ModifiedBy: 'Status Check',
        });
        if (published) {
          await publishForNotificationWithCompensation(notifiedRun);
        }
      }

      if (nextStatusTerminal && existingRun.RunCostOutcome?.CostCapturedAt == null) {
        const costOutcome = await safeCaptureRunCost(laboratoryRun);
        if (costOutcome) {
          laboratoryRun = await laboratoryRunService.update({
            ...laboratoryRun,
            RunCostOutcome: costOutcome,
            ModifiedAt: new Date().toISOString(),
            ModifiedBy: 'Status Check',
          });
        }
      }
    } else if (
      (snapshot.durationSeconds != null && existingRun.RunDurationSeconds == null) ||
      hasProgressChanged(existingRun, snapshot.progress)
    ) {
      // No status change, but duration and/or task progress need persisting.
      // Progress can change continuously while Status stays RUNNING.
      const now = new Date();
      const { update: progressUpdate } = buildProgressUpdate(existingRun, snapshot.progress, false);
      laboratoryRun = await laboratoryRunService.update({
        ...progressUpdate,
        ...(snapshot.durationSeconds != null && existingRun.RunDurationSeconds == null
          ? { RunDurationSeconds: snapshot.durationSeconds }
          : {}),
        ModifiedAt: now.toISOString(),
        ModifiedBy: 'Status Check',
      });
    }
  } else {
    console.error(`Unsupported SNS Processing Event Operation: ${operation}`);
  }
  return true;
}

async function fetchPlatformRunSnapshot(laboratoryRun: LaboratoryRun): Promise<PlatformRunSnapshot> {
  if (laboratoryRun.Platform === 'AWS HealthOmics') {
    return getAWSHealthOmicsStatus(laboratoryRun);
  }
  if (laboratoryRun.Platform === 'Seqera Cloud') {
    return getSeqeraCloudStatus(laboratoryRun);
  }
  return { status: laboratoryRun.Status };
}

export async function getAWSHealthOmicsStatus(laboratoryRun: LaboratoryRun): Promise<PlatformRunSnapshot> {
  console.log('Fetching AWS Health Omics status for run: ', laboratoryRun.RunId);

  const omicsUserId = laboratoryRun.UserId || 'status-check';
  const omicsService = await createOmicsServiceForLab(
    laboratoryRun.LaboratoryId,
    laboratoryRun.OrganizationId,
    omicsUserId,
  );

  const response = await omicsService.getRun(<GetRunCommandInput>{
    id: laboratoryRun.ExternalRunId,
  });

  // Omics exposes startTime and stopTime but not a direct duration, so compute it once here.
  const startMs = toMsIfPresent(response.startTime);
  const stopMs = toMsIfPresent(response.stopTime);
  const durationSeconds =
    startMs != null && stopMs != null && stopMs >= startMs ? Math.round((stopMs - startMs) / 1000) : undefined;

  const status = response.status || 'UNKNOWN';
  let progress: OmicsTaskProgress | undefined;
  if (!isTerminalLaboratoryRunStatus(status) && laboratoryRun.ExternalRunId) {
    try {
      const tasks = await omicsService.listAllRunTasks(laboratoryRun.ExternalRunId);
      progress = aggregateTaskProgress(tasks);
    } catch (err) {
      // Progress is best-effort; do not fail the status-check pipeline if ListRunTasks fails.
      console.warn(`ListRunTasks failed for RunId=${laboratoryRun.RunId}:`, err);
    }
  }

  return {
    status,
    durationSeconds,
    failureReason: response.failureReason,
    statusMessage: response.statusMessage,
    progress,
  };
}

export async function getSeqeraCloudStatus(laboratoryRun: LaboratoryRun): Promise<PlatformRunSnapshot> {
  console.log('Fetching NF Tower status for run: ', laboratoryRun.RunId);
  const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryRun.LaboratoryId);

  // Retrieve Seqera Cloud / NextFlow Tower AccessToken from SSM
  const getParameterResponse: GetParameterCommandOutput | void = await ssmService
    .getParameter({
      Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/nf-access-token`,
      WithDecryption: true,
    })
    .catch((error: any) => {
      if (error instanceof ParameterNotFound) {
        throw new LaboratoryAccessTokenUnavailableError();
      } else {
        throw error;
      }
    });
  if (!getParameterResponse) {
    throw new LaboratoryAccessTokenUnavailableError();
  }

  const accessToken: string | undefined = getParameterResponse.Parameter?.Value;
  if (!accessToken) {
    throw new LaboratoryAccessTokenUnavailableError();
  }

  // Get Query Parameters for Seqera Cloud / NextFlow Tower APIs
  const apiQueryParameters: string = getNextFlowApiQueryParameters(undefined, laboratory.NextFlowTowerWorkspaceId);
  const response: DescribeWorkflowResponse = await httpRequest<DescribeWorkflowResponse>(
    `${process.env.SEQERA_API_BASE_URL}/workflow/${laboratoryRun.ExternalRunId}?${apiQueryParameters}`,
    REST_API_METHOD.GET,
    { Authorization: `Bearer ${accessToken}` },
  );

  const workflow: any = response.workflow;
  // Seqera exposes `duration` directly (milliseconds); prefer it to avoid any ambiguity,
  // and fall back to start/complete subtraction only if the direct value is unavailable.
  const durationMsDirect = typeof workflow?.duration === 'number' ? workflow.duration : undefined;
  let durationSeconds: number | undefined =
    durationMsDirect != null && durationMsDirect >= 0 ? Math.round(durationMsDirect / 1000) : undefined;

  if (durationSeconds == null) {
    const startMs = toMsIfPresent(workflow?.start);
    const completeMs = toMsIfPresent(workflow?.complete);
    if (startMs != null && completeMs != null && completeMs >= startMs) {
      durationSeconds = Math.round((completeMs - startMs) / 1000);
    }
  }

  const status = workflow?.status || 'UNKNOWN';
  let progress: OmicsTaskProgress | undefined;
  if (!isTerminalLaboratoryRunStatus(status) && laboratoryRun.ExternalRunId) {
    try {
      const progressResponse: WorkflowProgressResponse = await httpRequest<WorkflowProgressResponse>(
        `${process.env.SEQERA_API_BASE_URL}/workflow/${laboratoryRun.ExternalRunId}/progress?${apiQueryParameters}`,
        REST_API_METHOD.GET,
        { Authorization: `Bearer ${accessToken}` },
      );
      progress = aggregateSeqeraProgress(progressResponse.progress);
    } catch (err) {
      // Progress is best-effort; do not fail the status-check pipeline if progress fetch fails.
      console.warn(`Seqera workflow progress failed for RunId=${laboratoryRun.RunId}:`, err);
    }
  }

  return {
    status,
    durationSeconds,
    failureReason: workflow?.errorMessage,
    errorReport: workflow?.errorReport,
    progress,
  };
}
