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
import { DescribeWorkflowResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
import { APIGatewayProxyResult, Handler, SQSRecord } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
//import { v4 as uuidv4 } from 'uuid';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import { SsmService } from '@BE/services/ssm-service';
import {
  calculateExpiresAtEpochSeconds,
  getRetentionMonthsOrDefault,
  getTerminalAtIsoString,
  isTerminalLaboratoryRunStatus,
  shouldExpireWithRetentionMonths,
} from '@BE/utils/laboratory-run-ttl-utils';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const laboratoryDataTaggingService = new LaboratoryDataTaggingService();
const ssmService = new SsmService();

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

export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const body = JSON.parse(sqsRecord.body);
      const snsEvent: SnsProcessingEvent = <SnsProcessingEvent>JSON.parse(body.Message);

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
};

function toMsIfPresent(value: Date | string | undefined): number | undefined {
  if (!value) return undefined;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : undefined;
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

    // Backfill branch: run is already terminal but missing one or more of
    // TerminalAt / ExpiresAt / RunDurationSeconds. Fetch platform data once so we can heal
    // historical rows without waiting for another status transition.
    if (isAlreadyTerminal && (missingTerminalAt || missingExpiresAt || missingDuration)) {
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

      laboratoryRun = await laboratoryRunService.update({
        ...existingRun,
        Status: newStatusNormalized,
        ...(shouldSetTerminalAt ? { TerminalAt: terminalAtIso } : {}),
        ...(newExpiresAt !== undefined ? { ExpiresAt: newExpiresAt } : {}),
        ...(snapshot.durationSeconds != null && existingRun.RunDurationSeconds == null
          ? { RunDurationSeconds: snapshot.durationSeconds }
          : {}),
        ModifiedAt: now.toISOString(),
        ModifiedBy: 'Status Check',
      });
      await safePropagateExpiresAt(laboratory, laboratoryRun, newExpiresAt);
    } else if (snapshot.durationSeconds != null && existingRun.RunDurationSeconds == null) {
      // No status change, but the platform now reports a duration we hadn't captured yet.
      const now = new Date();
      laboratoryRun = await laboratoryRunService.update({
        ...existingRun,
        RunDurationSeconds: snapshot.durationSeconds,
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

  return {
    status: response.status || 'UNKNOWN',
    durationSeconds,
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

  return {
    status: workflow?.status || 'UNKNOWN',
    durationSeconds,
  };
}
