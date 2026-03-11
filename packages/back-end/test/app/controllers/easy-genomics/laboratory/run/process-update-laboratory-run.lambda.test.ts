import { Context } from 'aws-lambda';
import { SQSEvent, SQSRecord } from 'aws-lambda/trigger/sqs';
import { GetRunCommandInput } from '@aws-sdk/client-omics';
import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';

import {
  handler,
  getAWSHealthOmicsStatus,
  getSeqeraCloudStatus,
  processStatusCheckEvent,
} from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-update-laboratory-run.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/ssm-service');
jest.mock('../../../../../../src/app/services/omics-service');
jest.mock('../../../../../../src/app/utils/rest-api-utils');

import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { SsmService } from '../../../../../../src/app/services/ssm-service';
import { OmicsService } from '../../../../../../src/app/services/omics-service';
import { getNextFlowApiQueryParameters, httpRequest } from '../../../../../../src/app/utils/rest-api-utils';

describe('process-update-laboratory-run.lambda', () => {
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;
  let mockOmicsService: jest.MockedClass<typeof OmicsService>;

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
    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    process.env.SEQERA_API_BASE_URL = 'https://tower.example.com';
  });

  it('updates run status for AWS HealthOmics platform', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'PENDING',
      Platform: 'AWS HealthOmics',
    });

    (mockOmicsService.prototype.getRun as jest.Mock).mockResolvedValue({
      status: 'SUCCEEDED',
    } as any);

    (mockRunService.prototype.update as jest.Mock).mockResolvedValue({
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
    expect(mockOmicsService.prototype.getRun).toHaveBeenCalledWith(<GetRunCommandInput>{ id: 'ext-1' });
    expect(mockRunService.prototype.update).toHaveBeenCalled();
  });

  it('skips update when run has no ExternalRunId', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
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
    expect(mockOmicsService.prototype.getRun).not.toHaveBeenCalled();
    expect(mockRunService.prototype.update).not.toHaveBeenCalled();
  });

  it('uses Seqera Cloud to update status and honors access token from SSM', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'Seqera Cloud',
    });

    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValue(ssmResponse);

    (httpRequest as jest.Mock).mockResolvedValue({
      workflow: { status: 'COMPLETED' },
    });

    (mockRunService.prototype.update as jest.Mock).mockResolvedValue({
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
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'Seqera Cloud',
    });

    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    (mockSsmService.prototype.getParameter as jest.Mock).mockRejectedValue(new ParameterNotFound({}));

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1' },
      }),
    };

    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(500);
  });

  it('getAWSHealthOmicsStatus returns status from Omics response or UNKNOWN', async () => {
    (mockOmicsService.prototype.getRun as jest.Mock)
      .mockResolvedValueOnce({ status: 'COMPLETED' } as any)
      .mockResolvedValueOnce({} as any);

    const status1 = await getAWSHealthOmicsStatus({
      RunId: 'run-1',
      ExternalRunId: 'ext-1',
    } as any);
    const status2 = await getAWSHealthOmicsStatus({
      RunId: 'run-2',
      ExternalRunId: 'ext-2',
    } as any);

    expect(status1).toBe('COMPLETED');
    expect(status2).toBe('UNKNOWN');
    expect(mockOmicsService.prototype.getRun).toHaveBeenNthCalledWith(1, <GetRunCommandInput>{ id: 'ext-1' });
    expect(mockOmicsService.prototype.getRun).toHaveBeenNthCalledWith(2, <GetRunCommandInput>{ id: 'ext-2' });
  });

  it('getAWSHealthOmicsStatus propagates errors from OmicsService', async () => {
    (mockOmicsService.prototype.getRun as jest.Mock).mockRejectedValue(new Error('omics failure'));

    await expect(getAWSHealthOmicsStatus({ RunId: 'run-err', ExternalRunId: 'ext-err' } as any)).rejects.toThrow(
      'omics failure',
    );
  });

  it('getSeqeraCloudStatus builds NF Tower URL with workspaceId and returns workflow status', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValue(ssmResponse);

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    (httpRequest as jest.Mock).mockResolvedValue({
      workflow: { status: 'SUCCEEDED' },
    });

    const status = await getSeqeraCloudStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(status).toBe('SUCCEEDED');
    expect(getNextFlowApiQueryParameters as jest.Mock).toHaveBeenCalledWith(undefined, 'ws-1');
    expect(httpRequest as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('/workflow/ext-1?workspaceId=ws-1'),
      expect.anything(),
      expect.objectContaining({ Authorization: expect.stringContaining('Bearer') }),
    );
  });

  it('getSeqeraCloudStatus throws when SSM returns no Parameter or no Value', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmNoParam: GetParameterCommandOutput = { $metadata: {}, Parameter: undefined };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValueOnce(ssmNoParam);

    await expect(
      getSeqeraCloudStatus({ RunId: 'run-1', LaboratoryId: 'lab-1', ExternalRunId: 'ext-1' } as any),
    ).rejects.toThrow();

    const ssmNoValue: GetParameterCommandOutput = { $metadata: {}, Parameter: { Value: undefined } as any };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValueOnce(ssmNoValue);

    await expect(
      getSeqeraCloudStatus({ RunId: 'run-2', LaboratoryId: 'lab-1', ExternalRunId: 'ext-2' } as any),
    ).rejects.toThrow();
  });

  it('getSeqeraCloudStatus returns UNKNOWN when workflow status is missing', async () => {
    (mockLabService.prototype.queryByLaboratoryId as jest.Mock).mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    const ssmResponse: GetParameterCommandOutput = {
      $metadata: {},
      Parameter: { Value: 'token' },
    };
    (mockSsmService.prototype.getParameter as jest.Mock).mockResolvedValue(ssmResponse);

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    (httpRequest as jest.Mock).mockResolvedValue({});

    const status = await getSeqeraCloudStatus({
      RunId: 'run-3',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-3',
    } as any);

    expect(status).toBe('UNKNOWN');
  });

  it('processStatusCheckEvent returns true for non-UPDATE operations', async () => {
    const result = await processStatusCheckEvent('DELETE' as any, { RunId: 'run-1' } as any);
    expect(result).toBe(true);
  });

  it('processStatusCheckEvent skips update when status has not changed', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    (mockOmicsService.prototype.getRun as jest.Mock).mockResolvedValue({
      status: 'RUNNING',
    } as any);

    const result = await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(result).toBe(true);
    expect(mockRunService.prototype.update).not.toHaveBeenCalled();
  });

  it('processStatusCheckEvent does not update when status change is only casing difference', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockResolvedValue({
      RunId: 'run-2',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-2',
      Status: 'running',
      Platform: 'AWS HealthOmics',
    });

    (mockOmicsService.prototype.getRun as jest.Mock).mockResolvedValue({
      status: 'RUNNING',
    } as any);

    const result = await processStatusCheckEvent('UPDATE', { RunId: 'run-2' } as any);

    expect(result).toBe(true);
    expect(mockRunService.prototype.update).not.toHaveBeenCalled();
  });

  it('processStatusCheckEvent propagates errors from queryByRunId', async () => {
    (mockRunService.prototype.queryByRunId as jest.Mock).mockRejectedValue(new Error('lookup failed'));

    await expect(processStatusCheckEvent('UPDATE', { RunId: 'run-err' } as any)).rejects.toThrow('lookup failed');
  });
});
