import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, Handler, SQSRecord } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { NotificationService } from '@BE/services/easy-genomics/notification-service';

const notificationService = new NotificationService();

/**
 * SQS consumer for `laboratory-run-notification-queue`. A single message's per-recipient send
 * failures are caught inside `NotificationService` and never surface here; only a systemic
 * failure (e.g. the whole `notifyRunCompletion` call throwing) triggers SQS retry -> DLQ.
 */
export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const sqsRecords: SQSRecord[] = event.Records;
    for (const sqsRecord of sqsRecords) {
      const body = JSON.parse(sqsRecord.body);
      const snsEvent: SnsProcessingEvent = <SnsProcessingEvent>JSON.parse(body.Message);

      if (snsEvent.Type !== 'LaboratoryRun') {
        console.error(`Unsupported SNS Processing Event Type: ${snsEvent.Type}`);
        continue;
      }
      const laboratoryRun: LaboratoryRun = <LaboratoryRun>JSON.parse(JSON.stringify(snsEvent.Record));
      const { sent } = await notificationService.notifyRunCompletion(laboratoryRun);
      console.log(`process-notify-laboratory-run-completion: sent ${sent} email(s) for RunId=${laboratoryRun.RunId}`);
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success' }));
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err);
  }
};
