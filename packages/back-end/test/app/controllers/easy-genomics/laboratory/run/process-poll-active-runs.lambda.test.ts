import { Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-poll-active-runs.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/sqs-service');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { SqsService } from '../../../../../../src/app/services/sqs-service';

describe('process-poll-active-runs.lambda', () => {
  let mockQueryActiveForPolling: jest.Mock;
  let mockPublish: jest.Mock;

  const createContext = (): Context =>
    ({
      functionName: 'process-poll-active-runs',
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryActiveForPolling = jest.fn();
    mockPublish = jest.fn().mockResolvedValue({});
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.queryActiveForPolling =
      mockQueryActiveForPolling;
    (SqsService as jest.MockedClass<typeof SqsService>).prototype.sendMessage = mockPublish;
    process.env.SQS_LABORATORY_RUN_UPDATE_QUEUE_URL = 'https://sqs.region.amazonaws.com/acct/update-queue.fifo';
  });

  it('enqueues a status check for every active run with an ExternalRunId', async () => {
    mockQueryActiveForPolling.mockResolvedValue([
      { RunId: 'run-1', LaboratoryId: 'lab-1', ExternalRunId: 'ext-1' },
      { RunId: 'run-2', LaboratoryId: 'lab-1', ExternalRunId: 'ext-2' },
    ]);

    const result = await handler({}, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ MessageGroupId: 'update-laboratory-run-run-1' }),
    );
  });

  it('skips runs with no ExternalRunId', async () => {
    mockQueryActiveForPolling.mockResolvedValue([{ RunId: 'run-3', LaboratoryId: 'lab-1' }]);

    await handler({}, createContext(), () => {});

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('continues enqueueing remaining runs when sqsService.sendMessage rejects for one of them', async () => {
    mockQueryActiveForPolling.mockResolvedValue([
      { RunId: 'run-1', LaboratoryId: 'lab-1', ExternalRunId: 'ext-1' },
      { RunId: 'run-2', LaboratoryId: 'lab-1', ExternalRunId: 'ext-2' },
      { RunId: 'run-3', LaboratoryId: 'lab-1', ExternalRunId: 'ext-3' },
    ]);
    mockPublish.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('SQS send failed')).mockResolvedValueOnce({});

    const result = await handler({}, createContext(), () => {});

    expect(mockPublish).toHaveBeenCalledTimes(3);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ Status: 'Success', ActiveRuns: 3, Enqueued: 2 });
  });

  it('returns an error response when laboratoryRunService.queryActiveForPolling throws', async () => {
    mockQueryActiveForPolling.mockRejectedValue(new Error('DynamoDB query failed'));

    const result = await handler({}, createContext(), () => {});

    expect(mockPublish).not.toHaveBeenCalled();
    expect(result.statusCode).not.toBe(200);
    expect(JSON.parse(result.body)).toEqual(
      expect.objectContaining({ Error: 'DynamoDB query failed', ErrorCode: 'EG-100' }),
    );
  });
});
