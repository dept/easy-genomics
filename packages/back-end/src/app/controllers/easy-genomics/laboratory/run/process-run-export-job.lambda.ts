import { buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { RunExportService } from '@BE/services/easy-genomics/run-export-service';
import { type RunExportJobMessage } from '@BE/utils/run-export-utils';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';

const runExportService = new RunExportService();

export const handler: Handler = async (event: SQSEvent, context): Promise<APIGatewayProxyResult> => {
  try {
    for (const record of event.Records) {
      const job = parseSqsJsonBody<RunExportJobMessage>(record.body);
      await runExportService.processSqsRecord(job, () =>
        typeof context?.getRemainingTimeInMillis === 'function'
          ? context.getRemainingTimeInMillis()
          : Number.POSITIVE_INFINITY,
      );
    }
    return buildResponse(200, JSON.stringify({ Status: 'Success' }));
  } catch (err: any) {
    console.error(err);
    // Rethrow so SQS retries and the DLQ can take over. Returning buildErrorResponse
    // would look like success and drop the message with no FAILED status.
    throw err;
  }
};
