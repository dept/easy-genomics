/**
 * The usage nested stack creates this queue and the main nested stack publishes to it.
 * The main stack builds its URL and ARN from these helpers instead of a cross-stack
 * reference, so both stacks must derive the name the same way `SqsConstruct` does.
 */
export const RUN_COST_CAPTURE_QUEUE = 'run-cost-capture-queue';

/** Attempts before a capture message moves to the dead-letter queue. The consumer marks the run on the last one. */
export const RUN_COST_CAPTURE_MAX_RECEIVE_COUNT = 3;

export interface RunCostCaptureQueueLocation {
  namePrefix: string;
  region: string;
  account: string;
}

export const runCostCaptureQueueName = (namePrefix: string): string => `${namePrefix}-${RUN_COST_CAPTURE_QUEUE}.fifo`;

export const runCostCaptureQueueUrl = ({ namePrefix, region, account }: RunCostCaptureQueueLocation): string =>
  `https://sqs.${region}.amazonaws.com/${account}/${runCostCaptureQueueName(namePrefix)}`;

export const runCostCaptureQueueArn = ({ namePrefix, region, account }: RunCostCaptureQueueLocation): string =>
  `arn:aws:sqs:${region}:${account}:${runCostCaptureQueueName(namePrefix)}`;
