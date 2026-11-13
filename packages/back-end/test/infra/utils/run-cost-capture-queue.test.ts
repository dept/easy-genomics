import {
  RUN_COST_CAPTURE_QUEUE,
  runCostCaptureQueueArn,
  runCostCaptureQueueName,
  runCostCaptureQueueUrl,
} from '../../../src/infra/utils/run-cost-capture-queue';

describe('run-cost capture queue addressing', () => {
  const location = { namePrefix: 'dev-demo', region: 'us-east-1', account: '123456789012' };

  it('names the queue the way SqsConstruct names a FIFO queue', () => {
    expect(RUN_COST_CAPTURE_QUEUE).toBe('run-cost-capture-queue');
    expect(runCostCaptureQueueName('dev-demo')).toBe('dev-demo-run-cost-capture-queue.fifo');
  });

  it('builds the queue URL from the prefix, region and account', () => {
    expect(runCostCaptureQueueUrl(location)).toBe(
      'https://sqs.us-east-1.amazonaws.com/123456789012/dev-demo-run-cost-capture-queue.fifo',
    );
  });

  it('builds the queue ARN from the prefix, region and account', () => {
    expect(runCostCaptureQueueArn(location)).toBe(
      'arn:aws:sqs:us-east-1:123456789012:dev-demo-run-cost-capture-queue.fifo',
    );
  });
});
