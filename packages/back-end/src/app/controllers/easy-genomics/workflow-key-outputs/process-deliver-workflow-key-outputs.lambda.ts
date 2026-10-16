import { buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { LaboratoryRunNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  isProtectedLabDataDestination,
  parseKeyOutputDeliveryUri,
} from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-delivery';
import { APIGatewayProxyResult, Handler } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { WorkflowKeyOutputsService } from '@BE/services/easy-genomics/workflow-key-outputs-service';
import { S3Service } from '@BE/services/s3-service';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';
import {
  deliveryDestinationOverlapsSource,
  filesMatchingKeyOutputs,
  isPlatformKeyOutputDeliveryBucket,
  keyOutputDeliveryObjectKey,
} from '@BE/utils/workflow-key-output-delivery';
import { runKeyOutputsRoot, shouldEnqueueKeyOutputDelivery } from '@BE/utils/workflow-key-output-utils';

const laboratoryRunService = new LaboratoryRunService();
const workflowKeyOutputsService = new WorkflowKeyOutputsService();
const s3Service = new S3Service();

type DeliverWorkflowKeyOutputsMessage = {
  LaboratoryId: string;
  RunId: string;
};

/**
 * Copies a completed HealthOmics run's declared key outputs to the external
 * S3 URI saved for that workflow. A missing setting, a failed run, or no
 * matching files is a no-op. Copy failures are retried by the queue.
 */
export const handler: Handler = async (event: SQSEvent): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    for (const record of event.Records) {
      const message = parseSqsJsonBody<DeliverWorkflowKeyOutputsMessage>(record.body);
      await deliverKeyOutputs(message);
    }
    return buildResponse(200, JSON.stringify({ Status: 'Success' }));
  } catch (err: any) {
    // Throw so SQS retries the copy. Returning an error response would delete the message.
    console.error(err);
    throw err;
  }
};

async function deliverKeyOutputs(message: DeliverWorkflowKeyOutputsMessage): Promise<void> {
  let run;
  try {
    run = await laboratoryRunService.get(message.LaboratoryId, message.RunId);
  } catch (err) {
    if (err instanceof LaboratoryRunNotFoundError) {
      console.info(`Skip key output delivery for RunId=${message.RunId}: run was not found`);
      return;
    }
    throw err;
  }
  if (!shouldEnqueueKeyOutputDelivery(run)) {
    console.info(`Skip key output delivery for RunId=${message.RunId}: run is not a completed HealthOmics run`);
    return;
  }

  const definition = await workflowKeyOutputsService.get(run.LaboratoryId, run.WorkflowExternalId!);
  if (!definition?.Delivery?.Enabled || !definition.Delivery.DestinationUri || definition.KeyOutputs.length === 0) {
    console.info(`Skip key output delivery for RunId=${run.RunId}: delivery is off or nothing is declared`);
    return;
  }

  const destination = parseKeyOutputDeliveryUri(definition.Delivery.DestinationUri);
  const root = runKeyOutputsRoot(run);
  if (!destination || !root) {
    console.info(`Skip key output delivery for RunId=${run.RunId}: destination or output location is invalid`);
    return;
  }
  if (isProtectedLabDataDestination(destination.prefix) || isPlatformKeyOutputDeliveryBucket(destination.bucket)) {
    console.error(`Skip key output delivery for RunId=${run.RunId}: destination is not an external bucket`);
    return;
  }
  if (destination.bucket === root.bucket) {
    console.error(`Skip key output delivery for RunId=${run.RunId}: destination is the run output bucket`);
    return;
  }
  if (
    deliveryDestinationOverlapsSource({
      sourceBucket: root.bucket,
      sourcePrefix: root.prefix,
      destinationBucket: destination.bucket,
      destinationPrefix: destination.prefix,
    })
  ) {
    console.error(`Skip key output delivery for RunId=${run.RunId}: destination overlaps the run output`);
    return;
  }

  const listed = await s3Service.listAllObjectsUnderPrefix(root.bucket, root.prefix);
  const files = filesMatchingKeyOutputs(
    listed,
    root.prefix,
    definition.KeyOutputs.map((item) => item.Pattern),
  );
  for (const file of files) {
    await s3Service.copyObjectBySize({
      sourceBucket: root.bucket,
      sourceKey: file.key,
      destBucket: destination.bucket,
      destKey: keyOutputDeliveryObjectKey(file.relativePath, destination.prefix),
      sizeBytes: file.size,
    });
  }
  console.info(`Delivered ${files.length} key output file(s) for RunId=${run.RunId}`);
}
