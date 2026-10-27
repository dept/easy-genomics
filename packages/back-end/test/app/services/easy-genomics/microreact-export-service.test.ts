import { ParameterNotFound } from '@aws-sdk/client-ssm';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';

jest.mock('../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../src/app/services/easy-genomics/workflow-key-outputs-service');
jest.mock('../../../../src/app/services/s3-service');
jest.mock('../../../../src/app/services/ssm-service');
jest.mock('../../../../src/app/services/sqs-service');
jest.mock('../../../../src/app/services/microreact-service');

import { LaboratoryRunService } from '../../../../src/app/services/easy-genomics/laboratory-run-service';
import { MicroreactExportService } from '../../../../src/app/services/easy-genomics/microreact-export-service';
import { WorkflowKeyOutputsService } from '../../../../src/app/services/easy-genomics/workflow-key-outputs-service';
import { MicroreactService } from '../../../../src/app/services/microreact-service';
import { S3Service } from '../../../../src/app/services/s3-service';
import { SqsService } from '../../../../src/app/services/sqs-service';
import { SsmService } from '../../../../src/app/services/ssm-service';

const ORG_ID = '44444444-4444-4444-8444-444444444444';
const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const RUN_PREFIX = `${ORG_ID}/${LAB_ID}/results/1234567/`;
const METADATA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TREE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function completedRun(overrides?: Record<string, unknown>): any {
  return {
    LaboratoryId: LAB_ID,
    OrganizationId: ORG_ID,
    RunId: 'run-1',
    RunName: 'run-42',
    WorkflowName: 'viralrecon',
    Platform: 'AWS HealthOmics',
    Status: 'COMPLETED',
    WorkflowExternalId: 'wf-1',
    ExternalRunId: '1234567',
    OutputS3Url: `s3://lab-bucket/${ORG_ID}/${LAB_ID}/results`,
    ...overrides,
  };
}

function definition(microreact?: Record<string, unknown>): any {
  return {
    LaboratoryId: LAB_ID,
    WorkflowId: 'wf-1',
    KeyOutputs: [
      { KeyOutputId: METADATA_ID, Label: 'Summary', Pattern: 'summary/*.tsv' },
      { KeyOutputId: TREE_ID, Label: 'Tree', Pattern: 'tree/*.nwk' },
    ],
    Delivery: {
      Enabled: false,
      Microreact: microreact ?? { Enabled: true, MetadataKeyOutputId: METADATA_ID, TreeKeyOutputIds: [TREE_ID] },
    },
  };
}

function s3Body(text: string) {
  return { Body: { transformToString: jest.fn().mockResolvedValue(text) } };
}

describe('MicroreactExportService', () => {
  let mockGetRun: jest.Mock;
  let mockUpdateRun: jest.Mock;
  let mockGetDefinition: jest.Mock;
  let mockList: jest.Mock;
  let mockGetObject: jest.Mock;
  let mockGetParameter: jest.Mock;
  let mockSendMessage: jest.Mock;
  let mockCreateProject: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SQS_KEY_OUTPUT_DELIVERY_QUEUE_URL = 'https://sqs/deliver.fifo';
    mockGetRun = jest.fn().mockResolvedValue(completedRun());
    mockUpdateRun = jest.fn().mockImplementation(async (run) => run);
    mockGetDefinition = jest.fn().mockResolvedValue(definition());
    mockList = jest.fn().mockResolvedValue([
      { Key: `${RUN_PREFIX}summary/samples.tsv`, Size: 20 },
      { Key: `${RUN_PREFIX}tree/phylogeny.nwk`, Size: 10 },
      { Key: `${RUN_PREFIX}work/tmp.txt`, Size: 4 },
    ]);
    mockGetObject = jest
      .fn()
      .mockImplementation(async ({ Key }) =>
        Key.endsWith('.tsv') ? s3Body('sample\tlineage\nS1\tB.1\n') : s3Body('(S1:0.1);'),
      );
    mockGetParameter = jest.fn().mockResolvedValue({ Parameter: { Value: 'mr-token' } });
    mockSendMessage = jest.fn().mockResolvedValue({});
    mockCreateProject = jest.fn().mockResolvedValue('https://microreact.org/project/abc');

    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.get = mockGetRun;
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.updateWithAttributeRemoval =
      mockUpdateRun;
    (WorkflowKeyOutputsService as jest.MockedClass<typeof WorkflowKeyOutputsService>).prototype.get = mockGetDefinition;
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.listAllObjectsUnderPrefix = mockList;
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.getObject = mockGetObject;
    (SsmService as jest.MockedClass<typeof SsmService>).prototype.getParameter = mockGetParameter;
    (SqsService as jest.MockedClass<typeof SqsService>).prototype.sendMessage = mockSendMessage;
    (MicroreactService as jest.MockedClass<typeof MicroreactService>).prototype.createProject = mockCreateProject;
  });

  describe('exportRun', () => {
    it('sends the metadata and tree files and records the project URL', async () => {
      const status = await new MicroreactExportService().exportRun(completedRun(), definition());

      expect(status).toBe('Succeeded');
      expect(mockGetParameter).toHaveBeenCalledWith({
        Name: `/easy-genomics/organization/${ORG_ID}/laboratory/${LAB_ID}/microreact-access-token`,
        WithDecryption: true,
      });
      const [project, token] = mockCreateProject.mock.calls[0];
      expect(token).toBe('mr-token');
      expect(project.meta.name).toBe('viralrecon / run-42');
      expect(project.datasets['dataset-1'].idFieldName).toBe('sample');
      expect(Object.keys(project.trees)).toEqual(['tree-1']);
      expect(mockUpdateRun).toHaveBeenCalledWith(
        expect.objectContaining({
          MicroreactStatus: 'Succeeded',
          MicroreactProjectUrl: 'https://microreact.org/project/abc',
        }),
        ['MicroreactErrorMessage'],
      );
    });

    it('records a failure when the lab has no Microreact access token', async () => {
      mockGetParameter.mockRejectedValue(
        new ParameterNotFound({ message: 'Parameter not found', $metadata: {} } as any),
      );

      const status = await new MicroreactExportService().exportRun(completedRun(), definition());

      expect(status).toBe('Failed');
      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(mockUpdateRun).toHaveBeenCalledWith(
        expect.objectContaining({
          MicroreactStatus: 'Failed',
          MicroreactErrorMessage: 'Add a Microreact access token in the laboratory settings',
        }),
        [],
      );
    });

    it('records the SSM error when the token lookup fails for another reason', async () => {
      mockGetParameter.mockRejectedValue(new Error('AccessDeniedException'));

      const status = await new MicroreactExportService().exportRun(completedRun(), definition());

      expect(status).toBe('Failed');
      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(mockUpdateRun).toHaveBeenCalledWith(
        expect.objectContaining({
          MicroreactStatus: 'Failed',
          MicroreactErrorMessage: 'AccessDeniedException',
        }),
        [],
      );
    });

    it('records a failure when no file matches the metadata key output', async () => {
      mockList.mockResolvedValue([{ Key: `${RUN_PREFIX}tree/phylogeny.nwk`, Size: 10 }]);

      await new MicroreactExportService().exportRun(completedRun(), definition());

      expect(mockUpdateRun).toHaveBeenCalledWith(
        expect.objectContaining({
          MicroreactErrorMessage: 'No file on this run matches the metadata key output "Summary" (summary/*.tsv)',
        }),
        [],
      );
    });

    it('records a failure when the metadata key output is no longer declared', async () => {
      const stale = definition({ Enabled: true, MetadataKeyOutputId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });

      await new MicroreactExportService().exportRun(completedRun(), stale);

      expect(mockUpdateRun).toHaveBeenCalledWith(
        expect.objectContaining({
          MicroreactErrorMessage:
            'The Microreact metadata key output is no longer declared for this workflow. Choose it again on the delivery page.',
        }),
        [],
      );
    });

    it('records a failure when the files are too large to embed', async () => {
      mockList.mockResolvedValue([{ Key: `${RUN_PREFIX}summary/samples.tsv`, Size: 11 * 1024 * 1024 }]);

      await new MicroreactExportService().exportRun(completedRun(), definition());

      expect(mockGetObject).not.toHaveBeenCalled();
      expect(mockUpdateRun).toHaveBeenCalledWith(
        expect.objectContaining({ MicroreactErrorMessage: expect.stringContaining('larger than 10 MB') }),
        [],
      );
    });

    it('records the Microreact API error', async () => {
      mockCreateProject.mockRejectedValue(new InvalidRequestError('Microreact returned HTTP 400: bad schema'));

      await new MicroreactExportService().exportRun(completedRun(), definition());

      expect(mockUpdateRun).toHaveBeenCalledWith(
        expect.objectContaining({ MicroreactErrorMessage: 'Microreact returned HTTP 400: bad schema' }),
        [],
      );
    });
  });

  describe('requestExport', () => {
    const request = { LaboratoryId: LAB_ID, RunId: 'run-1' };

    it('marks the run queued, then enqueues a Microreact-only delivery', async () => {
      const response = await new MicroreactExportService().requestExport(request);

      expect(response).toEqual({ RunId: 'run-1', MicroreactStatus: 'Queued' });
      expect(mockUpdateRun).toHaveBeenCalledWith(expect.objectContaining({ MicroreactStatus: 'Queued' }), [
        'MicroreactErrorMessage',
      ]);
      const message = mockSendMessage.mock.calls[0][0];
      expect(message.QueueUrl).toBe('https://sqs/deliver.fifo');
      expect(JSON.parse(message.MessageBody)).toEqual({ LaboratoryId: LAB_ID, RunId: 'run-1', Target: 'Microreact' });
      expect(message.MessageGroupId).toBe(`deliver-key-outputs-${LAB_ID}`);
      expect(mockUpdateRun.mock.invocationCallOrder[0]).toBeLessThan(mockSendMessage.mock.invocationCallOrder[0]);
    });

    it('rejects a run that has not completed', async () => {
      mockGetRun.mockResolvedValue(completedRun({ Status: 'RUNNING' }));

      await expect(new MicroreactExportService().requestExport(request)).rejects.toThrow(
        'Only completed HealthOmics runs can be sent to Microreact',
      );
    });

    it('rejects a workflow without a Microreact metadata key output', async () => {
      mockGetDefinition.mockResolvedValue(definition({ Enabled: false }));

      await expect(new MicroreactExportService().requestExport(request)).rejects.toThrow(
        'Choose a Microreact metadata key output on the delivery page first',
      );
    });

    it('marks the run failed when the message cannot be enqueued', async () => {
      mockSendMessage.mockRejectedValue(new Error('throttled'));

      await expect(new MicroreactExportService().requestExport(request)).rejects.toThrow('throttled');
      expect(mockUpdateRun).toHaveBeenLastCalledWith(
        expect.objectContaining({ MicroreactStatus: 'Failed', MicroreactErrorMessage: 'Could not queue the export' }),
        [],
      );
    });
  });
});
