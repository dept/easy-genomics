import { GetRunCommandInput } from '@aws-sdk/client-omics';
import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { Context } from 'aws-lambda';
import { SQSEvent, SQSRecord } from 'aws-lambda/trigger/sqs';

import {
  handler,
  getAWSHealthOmicsStatus,
  getSeqeraCloudStatus,
  processStatusCheckEvent,
} from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-update-laboratory-run.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/ssm-service');
jest.mock('../../../../../../src/app/services/omics-lab-factory');
jest.mock('../../../../../../src/app/utils/rest-api-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '../../../../../../src/app/services/omics-lab-factory';
import { SsmService } from '../../../../../../src/app/services/ssm-service';
import { getNextFlowApiQueryParameters, httpRequest } from '../../../../../../src/app/utils/rest-api-utils';

describe('process-update-laboratory-run.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;

  let mockQueryByRunId: jest.Mock;
  let mockUpdateRun: jest.Mock;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockGetParameter: jest.Mock;
  let mockGetRun: jest.Mock;

  const createEvent = (records: SQSRecord[]): SQSEvent =>
    ({
      Records: records,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'process-update-laboratory-run',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:process-update-laboratory-run',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/process-update-laboratory-run',
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
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
    mockSsmService = SsmService as jest.MockedClass<typeof SsmService>;

    mockQueryByRunId = jest.fn();
    mockUpdateRun = jest.fn();
    mockQueryByLaboratoryId = jest.fn();
    mockGetParameter = jest.fn();
    mockGetRun = jest.fn();

    mockRunService.prototype.queryByRunId = mockQueryByRunId;
    mockRunService.prototype.update = mockUpdateRun;
    mockLabService.prototype.queryByLaboratoryId = mockQueryByLaboratoryId;
    mockSsmService.prototype.getParameter = mockGetParameter;
    (createOmicsServiceForLab as jest.Mock).mockResolvedValue({ getRun: mockGetRun });

    mockQueryByLaboratoryId.mockResolvedValue({
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      RunRetentionMonths: 0,
    });

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    process.env.SEQERA_API_BASE_URL = 'https://tower.example.com';
  });

  it('updates run status for AWS HealthOmics platform', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'PENDING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({
      status: 'SUCCEEDED',
    } as any);

    mockUpdateRun.mockResolvedValue({
      RunId: 'run-1',
      Status: 'SUCCEEDED',
    });

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1' },
      }),
    };

    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(createOmicsServiceForLab as jest.Mock).toHaveBeenCalledWith('lab-1', 'org-1', 'status-check');
    expect(mockGetRun).toHaveBeenCalledWith(<GetRunCommandInput>{ id: 'ext-1' });
    expect(mockRunService.prototype.update).toHaveBeenCalled();
  });

  it('skips update when run has no ExternalRunId', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: undefined,
      Status: 'PENDING',
      Platform: 'AWS HealthOmics',
    });

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1' },
      }),
    };

    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockRunService.prototype.update).not.toHaveBeenCalled();
  });

  it('uses Seqera Cloud to update status and honors access token from SSM', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'Seqera Cloud',
    });

    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    mockGetParameter.mockResolvedValue(ssmResponse);

    (httpRequest as jest.Mock).mockResolvedValue({
      workflow: { status: 'COMPLETED' },
    });

    mockUpdateRun.mockResolvedValue({
      RunId: 'run-1',
      Status: 'COMPLETED',
    });

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1' },
      }),
    };

    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockSsmService.prototype.getParameter).toHaveBeenCalled();
    expect(httpRequest as jest.Mock).toHaveBeenCalled();
    expect(mockRunService.prototype.update).toHaveBeenCalled();
  });

  it('handles missing SSM parameter by throwing LaboratoryAccessTokenUnavailableError', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'Seqera Cloud',
    });

    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    mockGetParameter.mockRejectedValue(new ParameterNotFound({ message: 'Parameter not found', $metadata: {} } as any));

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1' },
      }),
    };

    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('getAWSHealthOmicsStatus returns status and computes durationSeconds from startTime/stopTime', async () => {
    const start = new Date('2026-04-01T12:00:00.000Z');
    const stop = new Date('2026-04-01T13:30:00.000Z'); // 90 minutes = 5400 seconds
    mockGetRun
      .mockResolvedValueOnce({ status: 'COMPLETED', startTime: start, stopTime: stop } as any)
      .mockResolvedValueOnce({} as any);

    const snapshot1 = await getAWSHealthOmicsStatus({
      RunId: 'run-1',
      ExternalRunId: 'ext-1',
    } as any);
    const snapshot2 = await getAWSHealthOmicsStatus({
      RunId: 'run-2',
      ExternalRunId: 'ext-2',
    } as any);

    expect(snapshot1.status).toBe('COMPLETED');
    expect(snapshot1.durationSeconds).toBe(5400);
    expect(snapshot2.status).toBe('UNKNOWN');
    expect(snapshot2.durationSeconds).toBeUndefined();
    expect(mockGetRun).toHaveBeenNthCalledWith(1, <GetRunCommandInput>{ id: 'ext-1' });
    expect(mockGetRun).toHaveBeenNthCalledWith(2, <GetRunCommandInput>{ id: 'ext-2' });
  });

  it('getAWSHealthOmicsStatus propagates errors from OmicsService', async () => {
    mockGetRun.mockRejectedValue(new Error('omics failure'));

    await expect(getAWSHealthOmicsStatus({ RunId: 'run-err', ExternalRunId: 'ext-err' } as any)).rejects.toThrow(
      'omics failure',
    );
  });

  it('getSeqeraCloudStatus builds NF Tower URL with workspaceId and returns workflow status', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    mockGetParameter.mockResolvedValue(ssmResponse);

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    (httpRequest as jest.Mock).mockResolvedValue({
      workflow: {
        status: 'SUCCEEDED',
        duration: 5_400_000, // ms -> 5400 seconds
        start: '2026-04-01T12:00:00.000Z',
        complete: '2026-04-01T13:30:00.000Z',
      },
    });

    const snapshot = await getSeqeraCloudStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(snapshot.status).toBe('SUCCEEDED');
    expect(snapshot.durationSeconds).toBe(5400);
    expect(getNextFlowApiQueryParameters as jest.Mock).toHaveBeenCalledWith(undefined, 'ws-1');
    expect(httpRequest as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('/workflow/ext-1?workspaceId=ws-1'),
      expect.anything(),
      expect.objectContaining({ Authorization: expect.stringContaining('Bearer') }),
    );
  });

  it('getSeqeraCloudStatus throws when SSM returns no Parameter or no Value', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmNoParam: GetParameterCommandOutput = { $metadata: {}, Parameter: undefined };
    mockGetParameter.mockResolvedValueOnce(ssmNoParam);

    await expect(
      getSeqeraCloudStatus({ RunId: 'run-1', LaboratoryId: 'lab-1', ExternalRunId: 'ext-1' } as any),
    ).rejects.toThrow();

    const ssmNoValue: GetParameterCommandOutput = { $metadata: {}, Parameter: { Value: undefined } as any };
    mockGetParameter.mockResolvedValueOnce(ssmNoValue);

    await expect(
      getSeqeraCloudStatus({ RunId: 'run-2', LaboratoryId: 'lab-1', ExternalRunId: 'ext-2' } as any),
    ).rejects.toThrow();
  });

  it('getSeqeraCloudStatus returns UNKNOWN when workflow status is missing', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    mockGetParameter.mockResolvedValue(ssmResponse);

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    (httpRequest as jest.Mock).mockResolvedValue({});

    const snapshot = await getSeqeraCloudStatus({
      RunId: 'run-3',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-3',
    } as any);

    expect(snapshot.status).toBe('UNKNOWN');
    expect(snapshot.durationSeconds).toBeUndefined();
  });

  it('getSeqeraCloudStatus falls back to start/complete when duration is missing', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    mockGetParameter.mockResolvedValue(ssmResponse);

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    (httpRequest as jest.Mock).mockResolvedValue({
      workflow: {
        status: 'SUCCEEDED',
        start: '2026-04-01T12:00:00.000Z',
        complete: '2026-04-01T13:30:00.000Z',
      },
    });

    const snapshot = await getSeqeraCloudStatus({
      RunId: 'run-4',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-4',
    } as any);

    expect(snapshot.status).toBe('SUCCEEDED');
    expect(snapshot.durationSeconds).toBe(5400);
  });

  it('processStatusCheckEvent returns true for non-UPDATE operations', async () => {
    const result = await processStatusCheckEvent('DELETE' as any, { RunId: 'run-1' } as any);
    expect(result).toBe(true);
  });

  it('processStatusCheckEvent skips update when status has not changed', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({
      status: 'RUNNING',
    } as any);

    const result = await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(result).toBe(true);
    expect(mockRunService.prototype.update).not.toHaveBeenCalled();
  });

  it('processStatusCheckEvent does not update when status change is only casing difference', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-2',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-2',
      Status: 'running',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({
      status: 'RUNNING',
    } as any);

    const result = await processStatusCheckEvent('UPDATE', { RunId: 'run-2' } as any);

    expect(result).toBe(true);
    expect(mockRunService.prototype.update).not.toHaveBeenCalled();
  });

  it('processStatusCheckEvent propagates errors from queryByRunId', async () => {
    mockQueryByRunId.mockRejectedValue(new Error('lookup failed'));

    await expect(processStatusCheckEvent('UPDATE', { RunId: 'run-err' } as any)).rejects.toThrow('lookup failed');
  });
});
