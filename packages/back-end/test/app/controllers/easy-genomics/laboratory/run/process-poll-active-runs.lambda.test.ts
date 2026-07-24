import { Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-poll-active-runs.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/sns-service');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { SnsService } from '../../../../../../src/app/services/sns-service';

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
    (SnsService as jest.MockedClass<typeof SnsService>).prototype.publish = mockPublish;
    process.env.SNS_LABORATORY_RUN_UPDATE_TOPIC = 'arn:aws:sns:region:acct:update-topic.fifo';
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
});
