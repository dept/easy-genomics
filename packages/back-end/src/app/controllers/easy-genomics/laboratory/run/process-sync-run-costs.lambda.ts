import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { RunCostSyncService } from '@BE/services/easy-genomics/run-cost-sync-service';

const runCostSyncService = new RunCostSyncService();

/**
 * Scheduled daily Lambda: batch-sync AWS Cost Explorer billed costs onto
 * LaboratoryRun rows. Must not be invoked from user-facing API routes.
 *
 * EventBridge cron is wired in easy-genomics-nested-stack.
 */
export const handler: Handler = async (event: unknown): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const result = await runCostSyncService.syncRecentTerminalRuns();
    console.log('Cost sync complete:', result);
    return buildResponse(200, JSON.stringify({ Status: 'Success', ...result }));
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err);
  }
};
