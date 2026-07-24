import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { SnsService } from '@BE/services/sns-service';

const laboratoryRunService = new LaboratoryRunService();
const snsService = new SnsService();

/**
 * Scheduled poller: without this, a run's status only refreshes while a user has the lab
 * dashboard open (front-end `setTimeout` polling). This finds every currently non-terminal
 * run via the sparse `PollStatus_Index` GSI and re-enqueues a status check for each on the
 * same topic/queue `create-laboratory-run` already uses, so `process-update-laboratory-run`
 * observes terminal transitions even with no browser open.
 */
export const handler: Handler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const activeRuns: LaboratoryRun[] = await laboratoryRunService.queryActiveForPolling();
    console.log(`process-poll-active-runs: found ${activeRuns.length} active run(s)`);

    let enqueued = 0;
    for (const run of activeRuns) {
      if (!run.ExternalRunId) continue;
      const record: SnsProcessingEvent = {
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: run,
      };
      try {
        await snsService.publish({
          TopicArn: process.env.SNS_LABORATORY_RUN_UPDATE_TOPIC,
          Message: JSON.stringify(record),
          MessageGroupId: `update-laboratory-run-${run.RunId}`,
          MessageDeduplicationId: uuidv4(),
        });
        enqueued++;
      } catch (err) {
        console.warn(`process-poll-active-runs: failed to enqueue RunId=${run.RunId}:`, err);
      }
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success', ActiveRuns: activeRuns.length, Enqueued: enqueued }));
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err);
  }
};
