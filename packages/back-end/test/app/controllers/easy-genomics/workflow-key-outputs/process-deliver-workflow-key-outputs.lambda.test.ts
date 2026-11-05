import { LaboratoryRunNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Context, SQSEvent } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/workflow-key-outputs/process-deliver-workflow-key-outputs.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../src/app/services/easy-genomics/workflow-key-outputs-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/services/easy-genomics/microreact-export-service');

import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { MicroreactExportService } from '../../../../../src/app/services/easy-genomics/microreact-export-service';
import { WorkflowKeyOutputsService } from '../../../../../src/app/services/easy-genomics/workflow-key-outputs-service';
import { S3Service } from '../../../../../src/app/services/s3-service';

const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const RUN_PREFIX = `org-1/${LAB_ID}/results/1234567/`;

function completedRun(overrides?: Record<string, unknown>) {
  return {
    LaboratoryId: LAB_ID,
    OrganizationId: 'org-1',
    RunId: 'run-1',
    Platform: 'AWS HealthOmics',
    Status: 'COMPLETED',
    WorkflowExternalId: 'wf-1',
    ExternalRunId: '1234567',
    OutputS3Url: `s3://lab-bucket/org-1/${LAB_ID}/results`,
    ...overrides,
  };
}

function deliveryDefinition(overrides?: Record<string, unknown>) {
  return {
    LaboratoryId: LAB_ID,
    WorkflowId: 'wf-1',
    KeyOutputs: [
      {
        KeyOutputId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        Label: 'Summary',
        Pattern: 'reports/summary.html',
      },
    ],
    Delivery: { Enabled: true, DestinationUri: 's3://results-bucket/incoming' },
    ...overrides,
  };
}

describe('process-deliver-workflow-key-outputs Lambda', () => {
  let mockGetRun: jest.Mock;
  let mockGetDefinition: jest.Mock;
  let mockList: jest.Mock;
  let mockCopy: jest.Mock;
  let mockExportRun: jest.Mock;

  const event = (target?: 'Microreact'): SQSEvent =>
    ({
      Records: [
        {
          body: JSON.stringify({ LaboratoryId: LAB_ID, RunId: 'run-1', ...(target ? { Target: target } : {}) }),
          messageId: '1',
          receiptHandle: 'handle',
          attributes: {},
          messageAttributes: {},
          md5OfBody: '',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123:deliver.fifo',
          awsRegion: 'us-east-1',
        },
      ],
    }) as SQSEvent;

  const context = {
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  } as unknown as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRun = jest.fn().mockResolvedValue(completedRun());
    mockGetDefinition = jest.fn().mockResolvedValue(deliveryDefinition());
    mockList = jest.fn().mockResolvedValue([
      { Key: `${RUN_PREFIX}reports/summary.html`, Size: 12 },
      { Key: `${RUN_PREFIX}work/tmp.txt`, Size: 4 },
    ]);
    mockCopy = jest.fn().mockResolvedValue(undefined);

    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.get = mockGetRun;
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = mockGetDefinition;
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.listAllObjectsUnderPrefix = mockList;
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.copyObjectBySize = mockCopy;
    mockExportRun = jest.fn().mockResolvedValue('Succeeded');
    (MicroreactExportService as jest.MockedClass<typeof MicroreactExportService>).prototype.exportRun = mockExportRun;
  });

  const microreact = { Enabled: true, MetadataKeyOutputId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

  it('sends to Microreact and copies to S3 when both are enabled', async () => {
    const definition = deliveryDefinition({
      Delivery: { Enabled: true, DestinationUri: 's3://results-bucket/incoming', Microreact: microreact },
    });
    mockGetDefinition.mockResolvedValue(definition);

    await handler(event(), context, () => {});

    expect(mockExportRun).toHaveBeenCalledWith(completedRun(), definition);
    expect(mockCopy).toHaveBeenCalledTimes(1);
  });

  it('does not send to Microreact automatically when it is off', async () => {
    mockGetDefinition.mockResolvedValue(
      deliveryDefinition({
        Delivery: {
          Enabled: true,
          DestinationUri: 's3://results-bucket/incoming',
          Microreact: { ...microreact, Enabled: false },
        },
      }),
    );

    await handler(event(), context, () => {});

    expect(mockExportRun).not.toHaveBeenCalled();
    expect(mockCopy).toHaveBeenCalledTimes(1);
  });

  it('does not create a second project when a retried message already succeeded', async () => {
    mockGetRun.mockResolvedValue(completedRun({ MicroreactStatus: 'Succeeded' }));
    mockGetDefinition.mockResolvedValue(deliveryDefinition({ Delivery: { Enabled: false, Microreact: microreact } }));

    await handler(event(), context, () => {});

    expect(mockExportRun).not.toHaveBeenCalled();
  });

  it('only sends to Microreact for a manual send, even when it already succeeded', async () => {
    mockGetRun.mockResolvedValue(completedRun({ MicroreactStatus: 'Succeeded' }));
    mockGetDefinition.mockResolvedValue(
      deliveryDefinition({
        Delivery: {
          Enabled: true,
          DestinationUri: 's3://results-bucket/incoming',
          Microreact: { ...microreact, Enabled: false },
        },
      }),
    );

    await handler(event('Microreact'), context, () => {});

    expect(mockExportRun).toHaveBeenCalledTimes(1);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('copies only the files that match a declared pattern', async () => {
    const result = await handler(event(), context, () => {});

    expect(result.statusCode).toEqual(200);
    expect(mockCopy).toHaveBeenCalledTimes(1);
    expect(mockCopy).toHaveBeenCalledWith({
      sourceBucket: 'lab-bucket',
      sourceKey: `${RUN_PREFIX}reports/summary.html`,
      destBucket: 'results-bucket',
      destKey: 'incoming/reports/summary.html',
      sizeBytes: 12,
    });
  });

  it('does not list the run when delivery is off', async () => {
    mockGetDefinition.mockResolvedValue(deliveryDefinition({ Delivery: { Enabled: false } }));

    await handler(event(), context, () => {});

    expect(mockList).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('does not list the run when nothing is declared', async () => {
    mockGetDefinition.mockResolvedValue(deliveryDefinition({ KeyOutputs: [] }));

    await handler(event(), context, () => {});

    expect(mockList).not.toHaveBeenCalled();
  });

  it('does not copy a failed run', async () => {
    mockGetRun.mockResolvedValue(completedRun({ Status: 'FAILED' }));

    await handler(event(), context, () => {});

    expect(mockGetDefinition).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('does not copy into an Easy Genomics platform bucket', async () => {
    process.env.NAME_PREFIX = 'eg-test';
    mockGetDefinition.mockResolvedValue(
      deliveryDefinition({ Delivery: { Enabled: true, DestinationUri: 's3://eg-test-org-email-assets-bucket/inbox' } }),
    );

    await handler(event(), context, () => {});

    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('does not copy when the destination overlaps the run output', async () => {
    mockGetDefinition.mockResolvedValue(
      deliveryDefinition({
        Delivery: { Enabled: true, DestinationUri: `s3://lab-bucket/org-1/${LAB_ID}/results/1234567/out` },
      }),
    );

    await handler(event(), context, () => {});

    expect(mockList).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('skips a missing run without retrying', async () => {
    mockGetRun.mockRejectedValue(new LaboratoryRunNotFoundError('run-1', LAB_ID));

    const result = await handler(event(), context, () => {});

    expect(result.statusCode).toEqual(200);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('throws when a copy fails so the queue retries', async () => {
    mockCopy.mockRejectedValue(new Error('copy failed'));

    await expect(handler(event(), context, () => {})).rejects.toThrow('copy failed');
  });

  it('does not list a run whose output prefix is outside this laboratory folder', async () => {
    mockGetRun.mockResolvedValue(completedRun({ OutputS3Url: 's3://lab-bucket/other-org/other-lab/results' }));

    await handler(event(), context, () => {});

    expect(mockList).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('does not copy onto an Easy Genomics laboratory data prefix', async () => {
    mockGetDefinition.mockResolvedValue(
      deliveryDefinition({
        Delivery: {
          Enabled: true,
          DestinationUri:
            's3://lab-bucket/b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f/c2f1e7b5-2e3c-5b7e-0a2d-2b3c4d5e6f70/out',
        },
      }),
    );

    await handler(event(), context, () => {});

    expect(mockList).not.toHaveBeenCalled();
    expect(mockCopy).not.toHaveBeenCalled();
  });
});
