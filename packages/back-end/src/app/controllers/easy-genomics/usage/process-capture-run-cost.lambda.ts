import { buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RunCostCaptureMessage,
  RunCostCaptureMessageSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-cost-capture-message';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { SQSEvent, SQSRecord } from 'aws-lambda/trigger/sqs';
import { RUN_COST_CAPTURE_MAX_RECEIVE_COUNT } from '../../../../infra/utils/run-cost-capture-queue';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { captureRunCostOutcome } from '@BE/services/easy-genomics/run-cost-capture-service';

const laboratoryRunService = new LaboratoryRunService();

/**
 * Records a finished run's platform cost. Large HealthOmics runs page through thousands of
 * tasks, so this runs with the full Lambda timeout. A thrown error leaves the message on the
 * queue for another attempt; after the last it moves to the dead-letter queue, and the run is
 * marked so the status check stops sending it back.
 */
export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  for (const record of event.Records) {
    const message = parseMessage(record.body);
    try {
      await captureAndRecord(message);
    } catch (err) {
      console.error(`Run cost capture failed for RunId=${message.RunId} (SQS will retry):`, err);
      if (isLastAttempt(record)) {
        await recordCaptureFailure(message, err);
      }
      throw err;
    }
  }
  return buildResponse(200, JSON.stringify({ Status: 'Success' }));
};

/** A missing or unreadable receive count counts as an earlier attempt, so the run is retried rather than marked early. */
function isLastAttempt(record: SQSRecord): boolean {
  const receiveCount = Number.parseInt(record.attributes?.ApproximateReceiveCount ?? '', 10);
  return Number.isFinite(receiveCount) && receiveCount >= RUN_COST_CAPTURE_MAX_RECEIVE_COUNT;
}

/** Logged, not thrown: the capture error is the one SQS and the logs need to see. */
async function recordCaptureFailure({ LaboratoryId, RunId }: RunCostCaptureMessage, captureError: unknown) {
  try {
    await laboratoryRunService.recordRunCostCaptureFailure({
      LaboratoryId,
      RunId,
      Error: captureError instanceof Error ? captureError.message : String(captureError),
    });
  } catch (err) {
    console.error(`Failed to mark run cost capture as given up for RunId=${RunId}:`, err);
  }
}

function parseMessage(body: string): RunCostCaptureMessage {
  const parsed = RunCostCaptureMessageSchema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new InvalidRequestError(`Run cost capture message is invalid: ${fields}`);
  }
  return parsed.data;
}

async function captureAndRecord({ RunId }: RunCostCaptureMessage): Promise<void> {
  const run = await laboratoryRunService.queryByRunId(RunId);
  if (run.RunCostOutcome?.CostCapturedAt) {
    console.info(`Run cost already recorded for RunId=${RunId}`);
    return;
  }

  const outcome = await captureRunCostOutcome(run);
  if (!outcome) {
    console.info(`No run cost to record for RunId=${RunId}: the platform reported none`);
    return;
  }

  const recorded = await laboratoryRunService.recordRunCostOutcome({
    LaboratoryId: run.LaboratoryId,
    RunId,
    RunCostOutcome: outcome,
    ModifiedBy: 'Cost Capture',
  });
  console.info(
    recorded ? `Run cost recorded for RunId=${RunId}` : `Run cost already recorded for RunId=${RunId} (concurrent)`,
  );
}
