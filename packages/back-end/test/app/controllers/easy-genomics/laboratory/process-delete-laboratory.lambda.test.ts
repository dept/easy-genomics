import { Context } from 'aws-lambda';
import { SQSEvent, SQSRecord } from 'aws-lambda/trigger/sqs';

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/process-delete-laboratory.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/platform-user-service');
jest.mock('../../../../../src/app/services/easy-genomics/user-service');
jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');

import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { PlatformUserService } from '../../../../../src/app/services/easy-genomics/platform-user-service';
import { UserService } from '../../../../../src/app/services/easy-genomics/user-service';

describe('process-delete-laboratory.lambda', () => {
  let mockPlatformUserService: jest.MockedClass<typeof PlatformUserService>;
  let mockUserService: jest.MockedClass<typeof UserService>;
  let mockLabRunService: jest.MockedClass<typeof LaboratoryRunService>;

  const createEvent = (records: SQSRecord[]): SQSEvent =>
    ({
      Records: records,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'process-delete-laboratory',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:process-delete-laboratory',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/process-delete-laboratory',
      logStreamName: '2026/03/11/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformUserService = PlatformUserService as jest.MockedClass<typeof PlatformUserService>;
    mockUserService = UserService as jest.MockedClass<typeof UserService>;
    mockLabRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;

    mockUserService.prototype.get = jest.fn();
    mockPlatformUserService.prototype.removeExistingUserFromLaboratory = jest.fn();
    mockLabRunService.prototype.queryByRunId = jest.fn();
    mockLabRunService.prototype.delete = jest.fn();
  });

  it('processes LaboratoryUser DELETE events', async () => {
    (mockUserService.prototype.get as jest.Mock).mockResolvedValue({
      UserId: 'user-1',
    });
    (mockPlatformUserService.prototype.removeExistingUserFromLaboratory as jest.Mock).mockResolvedValue({});

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'DELETE',
        Type: 'LaboratoryUser',
        Record: { LaboratoryId: 'lab-1', UserId: 'user-1' },
      }),
    };

    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
  });

  it('processes LaboratoryRun DELETE events', async () => {
    (mockLabRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-1',
    });
    (mockLabRunService.prototype.delete as jest.Mock).mockResolvedValue(true);

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'DELETE',
        Type: 'LaboratoryRun',
        Record: { LaboratoryId: 'lab-1', RunId: 'run-1' },
      }),
    };

    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockLabRunService.prototype.queryByRunId).toHaveBeenCalledWith('run-1');
    expect(mockLabRunService.prototype.delete).toHaveBeenCalled();
  });
});
