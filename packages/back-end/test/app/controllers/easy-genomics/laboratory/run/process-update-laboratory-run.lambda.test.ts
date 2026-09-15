import { GetRunCommandInput } from '@aws-sdk/client-omics';
import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { Context } from 'aws-lambda';
import { SQSEvent, SQSRecord } from 'aws-lambda/trigger/sqs';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/run-cost-capture-service');
jest.mock('../../../../../../src/app/services/ssm-service');
jest.mock('../../../../../../src/app/services/sqs-service');
jest.mock('../../../../../../src/app/services/omics-lab-factory');
jest.mock('../../../../../../src/app/utils/rest-api-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { captureRunCostOutcome } from '../../../../../../src/app/services/easy-genomics/run-cost-capture-service';
import { createOmicsServiceForLab } from '../../../../../../src/app/services/omics-lab-factory';
import { SqsService } from '../../../../../../src/app/services/sqs-service';
import { SsmService } from '../../../../../../src/app/services/ssm-service';
import { getNextFlowApiQueryParameters, httpRequest } from '../../../../../../src/app/utils/rest-api-utils';

// `markTerminalNotified` is a genuine prototype method on LaboratoryRunService (unlike its other,
// arrow-function-field methods), so Jest's automock snapshots this mock onto the lambda's
// module-level `laboratoryRunService` singleton the instant it's constructed by the import below.
// Reassigning `LaboratoryRunService.prototype.markTerminalNotified` after that point never reaches
// the already-constructed singleton, so capture the reference now and mutate it in place everywhere
// else in this file (beforeEach and individual tests) rather than replacing it.
const mockMarkTerminalNotifiedRef: jest.Mock = jest.fn();
LaboratoryRunService.prototype.markTerminalNotified = mockMarkTerminalNotifiedRef;

import {
  handler,
  getAWSHealthOmicsStatus,
  getSeqeraCloudStatus,
  processStatusCheckEvent,
} from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-update-laboratory-run.lambda';

describe('process-update-laboratory-run.lambda', () => {
  const terminalProgressRemoval = ['ProgressPercent', 'TasksTotal', 'TasksCompleted', 'TasksRunning', 'TasksFailed'];

  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockSsmService: jest.MockedClass<typeof SsmService>;
  let mockSqsService: jest.MockedClass<typeof SqsService>;

  let mockQueryByRunId: jest.Mock;
  let mockUpdateRun: jest.Mock;
  let mockMarkTerminalNotified: jest.Mock;
  let mockUpdateWithAttributeRemoval: jest.Mock;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockGetParameter: jest.Mock;
  let mockGetRun: jest.Mock;
  let mockPublish: jest.Mock;

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
    mockSqsService = SqsService as jest.MockedClass<typeof SqsService>;

    mockQueryByRunId = jest.fn();
    mockUpdateWithAttributeRemoval = jest.fn();
    // Status-check and backfill both use update(); compensateFailedNotification uses
    // updateWithAttributeRemoval. Point both mocks at the same fn so assertions work.
    mockUpdateRun = mockUpdateWithAttributeRemoval;
    mockQueryByLaboratoryId = jest.fn();
    mockGetParameter = jest.fn();
    mockGetRun = jest.fn();
    mockPublish = jest.fn().mockResolvedValue({});

    // Same mock instance as the module-level `laboratoryRunService` singleton's own
    // `markTerminalNotified` (see the comment at the top of this file) — mutate it in place,
    // don't replace it, or the singleton will never see the new behavior.
    mockMarkTerminalNotified = mockMarkTerminalNotifiedRef;
    mockMarkTerminalNotified.mockResolvedValue({ published: false, run: {} });

    mockRunService.prototype.queryByRunId = mockQueryByRunId;
    mockRunService.prototype.update = mockUpdateRun;
    mockRunService.prototype.updateWithAttributeRemoval = mockUpdateWithAttributeRemoval;
    mockLabService.prototype.queryByLaboratoryId = mockQueryByLaboratoryId;
    mockSsmService.prototype.getParameter = mockGetParameter;
    mockSqsService.prototype.sendMessage = mockPublish;
    (createOmicsServiceForLab as jest.Mock).mockResolvedValue({
      getRun: mockGetRun,
      // Default: progress fetch fails (best-effort). Tests that need task progress mock this explicitly.
      listAllRunTasks: jest.fn().mockRejectedValue(new Error('listAllRunTasks not mocked')),
    });
    (captureRunCostOutcome as jest.Mock).mockResolvedValue(undefined);

    mockQueryByLaboratoryId.mockResolvedValue({
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      RunRetentionMonths: 0,
    });

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    process.env.SEQERA_API_BASE_URL = 'https://tower.example.com';
    delete process.env.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL;
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

  it('getAWSHealthOmicsStatus continues without progress when listAllRunTasks fails', async () => {
    const listAllRunTasks = jest.fn().mockRejectedValue(new Error('ListRunTasks unavailable'));
    (createOmicsServiceForLab as jest.Mock).mockResolvedValue({
      getRun: mockGetRun,
      listAllRunTasks,
    });
    mockGetRun.mockResolvedValue({ status: 'RUNNING' } as any);

    const snapshot = await getAWSHealthOmicsStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(snapshot.status).toBe('RUNNING');
    expect(snapshot.progress).toBeUndefined();
    expect(listAllRunTasks).toHaveBeenCalledWith('ext-1');
  });

  it('getAWSHealthOmicsStatus does not call listAllRunTasks when status is terminal', async () => {
    const listAllRunTasks = jest.fn().mockResolvedValue([]);
    (createOmicsServiceForLab as jest.Mock).mockResolvedValue({
      getRun: mockGetRun,
      listAllRunTasks,
    });
    mockGetRun.mockResolvedValue({ status: 'COMPLETED' } as any);

    const snapshot = await getAWSHealthOmicsStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(snapshot.status).toBe('COMPLETED');
    expect(snapshot.progress).toBeUndefined();
    expect(listAllRunTasks).not.toHaveBeenCalled();
  });

  it('getAWSHealthOmicsStatus omits durationSeconds when stopTime is before startTime', async () => {
    const start = new Date('2026-04-01T13:00:00.000Z');
    const stop = new Date('2026-04-01T12:00:00.000Z');
    mockGetRun.mockResolvedValue({ status: 'COMPLETED', startTime: start, stopTime: stop } as any);

    const snapshot = await getAWSHealthOmicsStatus({
      RunId: 'run-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(snapshot.status).toBe('COMPLETED');
    expect(snapshot.durationSeconds).toBeUndefined();
  });

  it('getAWSHealthOmicsStatus passes laboratoryRun.UserId to createOmicsServiceForLab when present', async () => {
    mockGetRun.mockResolvedValue({ status: 'RUNNING' } as any);

    await getAWSHealthOmicsStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      UserId: 'user-42',
    } as any);

    expect(createOmicsServiceForLab).toHaveBeenCalledWith('lab-1', 'org-1', 'user-42');
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

  it('getAWSHealthOmicsStatus returns failureReason and statusMessage as separate fields', async () => {
    mockGetRun.mockResolvedValue({
      status: 'FAILED',
      failureReason: 'ECR_PERMISSION_ERROR',
      statusMessage: 'Cannot access ECR image (human-readable)',
    } as any);

    const snapshot = await getAWSHealthOmicsStatus({ RunId: 'run-1', ExternalRunId: 'ext-1' } as any);

    expect(snapshot.status).toBe('FAILED');
    expect(snapshot.failureReason).toBe('ECR_PERMISSION_ERROR');
    expect(snapshot.statusMessage).toBe('Cannot access ECR image (human-readable)');
  });

  it('getAWSHealthOmicsStatus keeps statusMessage distinct and does not collapse it into failureReason', async () => {
    mockGetRun.mockResolvedValue({
      status: 'FAILED',
      statusMessage: 'Engine failure — see CloudWatch',
    } as any);

    const snapshot = await getAWSHealthOmicsStatus({ RunId: 'run-1', ExternalRunId: 'ext-1' } as any);

    expect(snapshot.failureReason).toBeUndefined();
    expect(snapshot.statusMessage).toBe('Engine failure — see CloudWatch');
  });

  it('getAWSHealthOmicsStatus leaves both failure fields undefined when neither is present', async () => {
    mockGetRun.mockResolvedValue({ status: 'SUCCEEDED' } as any);

    const snapshot = await getAWSHealthOmicsStatus({ RunId: 'run-1', ExternalRunId: 'ext-1' } as any);

    expect(snapshot.failureReason).toBeUndefined();
    expect(snapshot.statusMessage).toBeUndefined();
  });

  it('getSeqeraCloudStatus returns failureReason from workflow.errorMessage', async () => {
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
      workflow: {
        status: 'FAILED',
        errorMessage: 'Process samplesheet_check failed with exit code 1',
        errorReport: 'Caused by:\n  Process `samplesheet_check` terminated with an error exit status (1)',
      },
    });

    const snapshot = await getSeqeraCloudStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(snapshot.status).toBe('FAILED');
    expect(snapshot.failureReason).toBe('Process samplesheet_check failed with exit code 1');
    expect(snapshot.errorReport).toBe(
      'Caused by:\n  Process `samplesheet_check` terminated with an error exit status (1)',
    );
  });

  it('processStatusCheckEvent persists FailureReason on FAILED transition for HealthOmics', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({
      status: 'FAILED',
      failureReason: 'OUT_OF_MEMORY_ERROR',
      statusMessage: 'Task nf-core/rnaseq:FASTQC ran out of memory — see CloudWatch',
    } as any);

    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'FAILED' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        Status: 'FAILED',
        FailureReason: 'OUT_OF_MEMORY_ERROR',
        FailureStatusMessage: 'Task nf-core/rnaseq:FASTQC ran out of memory — see CloudWatch',
      }),
      terminalProgressRemoval,
    );
  });

  it('processStatusCheckEvent persists FailureReason on FAILED transition for Seqera Cloud', async () => {
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
      workflow: {
        status: 'FAILED',
        errorMessage: 'Sample sheet parsing failed',
        errorReport: 'Caused by:\n  Missing required column "sample" in samplesheet.csv',
      },
    });

    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'FAILED' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        Status: 'FAILED',
        FailureReason: 'Sample sheet parsing failed',
        FailureErrorReport: 'Caused by:\n  Missing required column "sample" in samplesheet.csv',
      }),
      terminalProgressRemoval,
    );
  });

  it('processStatusCheckEvent does not overwrite existing FailureReason on subsequent FAILED status checks', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
      FailureReason: 'ECR_PERMISSION_ERROR',
    });

    mockGetRun.mockResolvedValue({
      status: 'FAILED',
      failureReason: 'SHOULD_NOT_OVERWRITE',
    } as any);

    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'FAILED' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    const updateArg = mockUpdateRun.mock.calls[0][0];
    expect(updateArg.FailureReason).toBe('ECR_PERMISSION_ERROR');
  });

  it('processStatusCheckEvent does not write FailureReason on non-FAILED transitions', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({
      status: 'SUCCEEDED',
      failureReason: 'IRRELEVANT',
    } as any);

    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'SUCCEEDED' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    const updateArg = mockUpdateRun.mock.calls[0][0];
    expect(updateArg.FailureReason).toBeUndefined();
  });

  it('safePublishForClassification: publishes to SNS when run transitions to FAILED and FailureOwner is unset', async () => {
    process.env.SQS_LABORATORY_RUN_FAILURE_CLASSIFICATION_QUEUE_URL = 'arn:aws:sns:us-east-1:123:classify.fifo';

    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({ status: 'FAILED', failureReason: 'OUT_OF_MEMORY_ERROR' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'FAILED' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: 'arn:aws:sns:us-east-1:123:classify.fifo',
        MessageGroupId: 'classify-laboratory-run-run-1',
      }),
    );
  });

  it('safePublishForClassification: skips publish when FailureOwner is already set', async () => {
    process.env.SQS_LABORATORY_RUN_FAILURE_CLASSIFICATION_QUEUE_URL = 'arn:aws:sns:us-east-1:123:classify.fifo';

    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
      FailureOwner: 'Bioinformatician',
    });

    mockGetRun.mockResolvedValue({ status: 'FAILED', failureReason: 'ECR_PERMISSION_ERROR' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'FAILED' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('safePublishForClassification: skips publish when topic ARN env var is unset', async () => {
    delete process.env.SQS_LABORATORY_RUN_FAILURE_CLASSIFICATION_QUEUE_URL;

    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({ status: 'FAILED', failureReason: 'OUT_OF_MEMORY_ERROR' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'FAILED' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('safePublishForClassification: swallows SNS errors so the status-check pipeline completes', async () => {
    process.env.SQS_LABORATORY_RUN_FAILURE_CLASSIFICATION_QUEUE_URL = 'arn:aws:sns:us-east-1:123:classify.fifo';
    mockPublish.mockRejectedValue(new Error('SNS unavailable'));

    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({ status: 'FAILED', failureReason: 'OUT_OF_MEMORY_ERROR' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'FAILED' });

    await expect(processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any)).resolves.toBe(true);
    expect(mockPublish).toHaveBeenCalled();
  });

  it('attaches RunCostOutcome when transitioning to a terminal status', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });
    mockGetRun.mockResolvedValue({
      status: 'SUCCEEDED',
      startTime: new Date('2026-01-01T00:00:00Z'),
      stopTime: new Date('2026-01-01T01:00:00Z'),
    } as any);
    (captureRunCostOutcome as jest.Mock).mockResolvedValue({
      ActualComputeCostUsd: 4.2,
      CostSource: 'HEALTHOMICS_TASKS',
      CostCapturedAt: '2026-01-01T02:00:00Z',
    });
    mockUpdateRun.mockImplementation(async (r) => r);

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(captureRunCostOutcome).toHaveBeenCalled();
    // Status is written first; cost is a follow-up update when capture succeeds.
    expect(mockUpdateRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Status: 'SUCCEEDED',
      }),
      terminalProgressRemoval,
    );
    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        RunCostOutcome: expect.objectContaining({ ActualComputeCostUsd: 4.2 }),
      }),
    );
  });

  it('swallows cost-capture failures on terminal transition', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });
    mockGetRun.mockResolvedValue({ status: 'SUCCEEDED' } as any);
    (captureRunCostOutcome as jest.Mock).mockRejectedValue(new Error('capture failed'));
    mockUpdateRun.mockImplementation(async (r) => r);

    await expect(processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any)).resolves.toBe(true);
    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        Status: 'SUCCEEDED',
      }),
      terminalProgressRemoval,
    );
    expect(mockUpdateRun).not.toHaveBeenCalledWith(expect.objectContaining({ RunCostOutcome: expect.anything() }));
  });

  it('backfills RunCostOutcome for already-terminal runs missing cost', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'SUCCEEDED',
      Platform: 'AWS HealthOmics',
      TerminalAt: '2026-01-01T00:00:00Z',
      RunDurationSeconds: 100,
    });
    (captureRunCostOutcome as jest.Mock).mockResolvedValue({
      ActualComputeCostUsd: 9,
      CostSource: 'HEALTHOMICS_TASKS',
      CostCapturedAt: '2026-01-02T00:00:00Z',
    });
    mockUpdateRun.mockImplementation(async (r) => r);

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(captureRunCostOutcome).toHaveBeenCalled();
    // Terminal metadata update first, then cost-only update.
    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        RunCostOutcome: expect.objectContaining({ ActualComputeCostUsd: 9 }),
      }),
    );
  });

  it('getSeqeraCloudStatus returns progress for non-terminal runs', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });

    mockGetParameter.mockResolvedValue({
      $metadata: {},
      Parameter: { Value: 'token' },
    });

    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    (httpRequest as jest.Mock)
      .mockResolvedValueOnce({
        workflow: { status: 'RUNNING', duration: 60_000 },
      })
      .mockResolvedValueOnce({
        progress: {
          workflowProgress: {
            pending: 1,
            submitted: 0,
            running: 2,
            succeeded: 5,
            failed: 0,
            cached: 0,
            cpus: 0,
            cpuTime: 0,
            cpuLoad: 0,
            memoryRss: 0,
            memoryReq: 0,
            readBytes: 0,
            writeBytes: 0,
            volCtxSwitch: 0,
            invCtxSwitch: 0,
            loadTasks: 0,
            loadCpus: 0,
            loadMemory: 0,
            peakCpus: 0,
            peakTasks: 0,
            peakMemory: 0,
          },
          processesProgress: [
            {
              process: 'BOWTIE2_ALIGN',
              pending: 0,
              submitted: 0,
              running: 2,
              succeeded: 0,
              failed: 0,
              cached: 0,
              cpus: 0,
              cpuTime: 0,
              cpuLoad: 0,
              memoryRss: 0,
              memoryReq: 0,
              readBytes: 0,
              writeBytes: 0,
              volCtxSwitch: 0,
              invCtxSwitch: 0,
              loadTasks: 0,
              loadCpus: 0,
              loadMemory: 0,
              peakCpus: 0,
              peakTasks: 0,
              peakMemory: 0,
            },
          ],
        },
      });

    const snapshot = await getSeqeraCloudStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(snapshot.status).toBe('RUNNING');
    expect(snapshot.progress).toEqual(
      expect.objectContaining({
        tasksCompleted: 5,
        tasksRunning: 2,
        tasksTotal: 8,
        percent: 63,
      }),
    );
    expect(httpRequest as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining('/workflow/ext-1/progress?workspaceId=ws-1'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('getSeqeraCloudStatus continues when progress fetch fails', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: 'lab-1',
      NextFlowTowerWorkspaceId: 'ws-1',
    });
    mockGetParameter.mockResolvedValue({ $metadata: {}, Parameter: { Value: 'token' } });
    (getNextFlowApiQueryParameters as jest.Mock).mockReturnValue('workspaceId=ws-1');
    (httpRequest as jest.Mock)
      .mockResolvedValueOnce({ workflow: { status: 'RUNNING', duration: 1000 } })
      .mockRejectedValueOnce(new Error('progress unavailable'));

    const snapshot = await getSeqeraCloudStatus({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      ExternalRunId: 'ext-1',
    } as any);

    expect(snapshot.status).toBe('RUNNING');
    expect(snapshot.progress).toBeUndefined();
  });

  it('processStatusCheckEvent persists progress for Omics while RUNNING', async () => {
    const listAllRunTasks = jest.fn().mockResolvedValue([
      { taskId: '1', status: 'COMPLETED', name: 'FASTQC' },
      { taskId: '2', status: 'RUNNING', name: 'BOWTIE2_ALIGN' },
    ]);
    (createOmicsServiceForLab as jest.Mock).mockResolvedValue({
      getRun: mockGetRun,
      listAllRunTasks,
    });

    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });

    mockGetRun.mockResolvedValue({ status: 'RUNNING' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', Status: 'RUNNING' });

    await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ProgressPercent: 50,
        TasksCompleted: 1,
        TasksTotal: 2,
      }),
    );
  });

  it('backfill branch: does not call markTerminalNotified again when NotifiedAt is already set, even if other fields still need healing', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'FAILED',
      Platform: 'AWS HealthOmics',
      // TerminalAt intentionally omitted so the backfill branch is still entered.
      ExpiresAt: 1234567890,
      RunDurationSeconds: 120,
      NotifiedAt: '2026-07-20T00:05:00.000Z',
    });
    mockUpdateRun.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Status: 'FAILED',
    });

    const result = await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(result).toBe(true);
    expect(mockRunService.prototype.update).toHaveBeenCalled();
    expect(mockMarkTerminalNotified).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('backfill branch: heals a missing notification on an already-terminal run whose other fields are already populated', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'FAILED',
      Platform: 'AWS HealthOmics',
      TerminalAt: '2026-07-20T00:00:00.000Z',
      ExpiresAt: 1234567890,
      RunDurationSeconds: 120,
    });
    mockUpdateRun.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Status: 'FAILED',
    });
    mockMarkTerminalNotified.mockResolvedValue({
      published: true,
      run: { RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'FAILED' },
    });
    process.env.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL =
      'https://sqs.region.amazonaws.com/acct/notification-queue.fifo';

    const result = await processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(result).toBe(true);
    // TerminalAt / ExpiresAt / RunDurationSeconds are already populated, so the platform
    // should never be queried for this purely notification-healing pass.
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockMarkTerminalNotified).toHaveBeenCalledWith(
      expect.objectContaining({ LaboratoryId: 'lab-1', RunId: 'run-1' }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: 'https://sqs.region.amazonaws.com/acct/notification-queue.fifo',
        MessageGroupId: 'notify-laboratory-run-run-1',
      }),
    );
  });

  it('does not publish to the notification topic when markTerminalNotified reports published: false', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });
    mockGetRun.mockResolvedValue({ status: 'SUCCEEDED' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' });
    mockMarkTerminalNotified.mockResolvedValue({
      published: false,
      run: { RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' },
    });

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1' },
      }),
    };
    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    await handler(event, createContext(), () => {});

    expect(mockPublish).not.toHaveBeenCalledWith(
      expect.objectContaining({ QueueUrl: expect.stringContaining('notification') }),
    );
  });

  it('publishes to the notification topic exactly once on a non-terminal -> terminal transition', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });
    mockGetRun.mockResolvedValue({ status: 'SUCCEEDED' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' });
    mockMarkTerminalNotified.mockResolvedValue({
      published: true,
      run: { RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' },
    });
    process.env.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL =
      'https://sqs.region.amazonaws.com/acct/notification-queue.fifo';

    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1' },
      }),
    };
    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    await handler(event, createContext(), () => {});

    expect(mockMarkTerminalNotified).toHaveBeenCalledWith(
      expect.objectContaining({ LaboratoryId: 'lab-1', RunId: 'run-1' }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: 'https://sqs.region.amazonaws.com/acct/notification-queue.fifo',
        MessageGroupId: 'notify-laboratory-run-run-1',
      }),
    );
  });

  it('safePublishForNotification: swallows SQS errors so the status-check pipeline completes', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });
    mockGetRun.mockResolvedValue({ status: 'SUCCEEDED' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' });
    mockMarkTerminalNotified.mockResolvedValue({
      published: true,
      run: { RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' },
    });
    process.env.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL =
      'https://sqs.region.amazonaws.com/acct/notification-queue.fifo';
    mockPublish.mockRejectedValue(new Error('SQS unavailable'));

    await expect(processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any)).resolves.toBe(true);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: 'https://sqs.region.amazonaws.com/acct/notification-queue.fifo',
        MessageGroupId: 'notify-laboratory-run-run-1',
      }),
    );
  });

  it('compensates a failed notification publish by restoring PollStatus and clearing NotifiedAt', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });
    mockGetRun.mockResolvedValue({ status: 'SUCCEEDED' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' });
    mockMarkTerminalNotified.mockResolvedValue({
      published: true,
      run: { RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' },
    });
    process.env.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL =
      'https://sqs.region.amazonaws.com/acct/notification-queue.fifo';
    mockPublish.mockRejectedValue(new Error('SQS unavailable'));

    await expect(processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any)).resolves.toBe(true);

    // The failed run stays retryable: PollStatus is restored so the poller finds it again,
    // and NotifiedAt is removed so the backfill branch's missingNotification check re-fires.
    expect(mockUpdateWithAttributeRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ RunId: 'run-1', LaboratoryId: 'lab-1', PollStatus: 'ACTIVE' }),
      ['NotifiedAt'],
    );
  });

  it('compensates a failed notification publish when the notification queue URL is not configured', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      ExternalRunId: 'ext-1',
      Status: 'RUNNING',
      Platform: 'AWS HealthOmics',
    });
    mockGetRun.mockResolvedValue({ status: 'SUCCEEDED' } as any);
    mockUpdateRun.mockResolvedValue({ RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' });
    mockMarkTerminalNotified.mockResolvedValue({
      published: true,
      run: { RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'SUCCEEDED' },
    });
    delete process.env.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL;

    await expect(processStatusCheckEvent('UPDATE', { RunId: 'run-1' } as any)).resolves.toBe(true);

    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockUpdateWithAttributeRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ RunId: 'run-1', LaboratoryId: 'lab-1', PollStatus: 'ACTIVE' }),
      ['NotifiedAt'],
    );
  });
});
