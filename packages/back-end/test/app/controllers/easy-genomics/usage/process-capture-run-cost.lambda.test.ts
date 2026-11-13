import { LaboratoryRunNotFoundError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { Context, SQSEvent } from 'aws-lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../src/app/services/easy-genomics/run-cost-capture-service');

import { handler } from '../../../../../src/app/controllers/easy-genomics/usage/process-capture-run-cost.lambda';
import { LaboratoryRunService } from '../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { captureRunCostOutcome } from '../../../../../src/app/services/easy-genomics/run-cost-capture-service';
import { RUN_COST_CAPTURE_MAX_RECEIVE_COUNT } from '../../../../../src/infra/utils/run-cost-capture-queue';

const LAB_ID = 'lab-1';
const RUN_ID = 'run-1';

const capturedOutcome = {
  ActualComputeCostUsd: 42.1,
  CostSource: 'HEALTHOMICS_TASKS' as const,
  CostCapturedAt: '2026-11-10T00:00:00.000Z',
};

const finishedRun = (overrides: Record<string, unknown> = {}) => ({
  LaboratoryId: LAB_ID,
  RunId: RUN_ID,
  OrganizationId: 'org-1',
  Platform: 'AWS HealthOmics',
  Status: 'COMPLETED',
  ExternalRunId: '1234567',
  ...overrides,
});

const event = (body: unknown, receiveCount?: string): SQSEvent =>
  ({
    Records: [
      {
        body: typeof body === 'string' ? body : JSON.stringify(body),
        messageId: '1',
        attributes: receiveCount === undefined ? {} : { ApproximateReceiveCount: receiveCount },
      },
    ],
  }) as any;

const invoke = (sqsEvent: SQSEvent) => handler(sqsEvent, {} as Context, () => {});

describe('process-capture-run-cost Lambda', () => {
  let mockQueryByRunId: jest.Mock;
  let mockRecordRunCostOutcome: jest.Mock;
  let mockRecordRunCostCaptureFailure: jest.Mock;
  const mockCapture = captureRunCostOutcome as jest.Mock;
  const laboratoryRunService = (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).mock
    .instances[0];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockQueryByRunId = jest.fn().mockResolvedValue(finishedRun());
    mockRecordRunCostOutcome = jest.fn().mockResolvedValue(true);
    laboratoryRunService.queryByRunId = mockQueryByRunId;
    laboratoryRunService.recordRunCostOutcome = mockRecordRunCostOutcome;
    mockRecordRunCostCaptureFailure = jest.fn().mockResolvedValue(true);
    laboratoryRunService.recordRunCostCaptureFailure = mockRecordRunCostCaptureFailure;
    mockCapture.mockResolvedValue(capturedOutcome);
  });

  it('records a captured outcome for the run named in the message', async () => {
    await invoke(event({ LaboratoryId: LAB_ID, RunId: RUN_ID }));

    expect(mockQueryByRunId).toHaveBeenCalledWith(RUN_ID);
    expect(mockCapture).toHaveBeenCalledWith(finishedRun());
    expect(mockRecordRunCostOutcome).toHaveBeenCalledWith({
      LaboratoryId: LAB_ID,
      RunId: RUN_ID,
      RunCostOutcome: capturedOutcome,
      ModifiedBy: 'Cost Capture',
    });
  });

  it('does not write again when the run already has a captured cost', async () => {
    mockQueryByRunId.mockResolvedValue(finishedRun({ RunCostOutcome: capturedOutcome }));

    await invoke(event({ LaboratoryId: LAB_ID, RunId: RUN_ID }));

    expect(mockRecordRunCostOutcome).not.toHaveBeenCalled();
  });

  it('acknowledges a run with no cost to record instead of retrying it', async () => {
    mockCapture.mockResolvedValue(undefined);

    await expect(invoke(event({ LaboratoryId: LAB_ID, RunId: RUN_ID }))).resolves.toBeDefined();

    expect(mockRecordRunCostOutcome).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining(`RunId=${RUN_ID}`));
  });

  it('throws when the capture fails so SQS retries the message', async () => {
    const throttled = new Error('ThrottlingException');
    mockCapture.mockRejectedValue(throttled);

    await expect(invoke(event({ LaboratoryId: LAB_ID, RunId: RUN_ID }))).rejects.toBe(throttled);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`RunId=${RUN_ID}`), throttled);
  });

  it('throws on a message that fails the schema, naming the field', async () => {
    await expect(invoke(event({ LaboratoryId: LAB_ID }))).rejects.toThrow(/RunId/);
    expect(mockQueryByRunId).not.toHaveBeenCalled();
  });

  it('throws when the run does not exist', async () => {
    mockQueryByRunId.mockRejectedValue(new LaboratoryRunNotFoundError(RUN_ID));

    await expect(invoke(event({ LaboratoryId: LAB_ID, RunId: RUN_ID }))).rejects.toBeInstanceOf(
      LaboratoryRunNotFoundError,
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  describe('on the last attempt', () => {
    const message = { LaboratoryId: LAB_ID, RunId: RUN_ID };
    const lastAttempt = String(RUN_COST_CAPTURE_MAX_RECEIVE_COUNT);

    it('records the failure marker and still throws the original error', async () => {
      const notFound = new Error('run not found on the platform');
      mockCapture.mockRejectedValue(notFound);

      await expect(invoke(event(message, lastAttempt))).rejects.toBe(notFound);

      expect(mockRecordRunCostCaptureFailure).toHaveBeenCalledWith({
        LaboratoryId: LAB_ID,
        RunId: RUN_ID,
        Error: 'run not found on the platform',
      });
    });

    it('records the marker when the run cannot be read at all', async () => {
      const notFound = new LaboratoryRunNotFoundError(RUN_ID);
      mockQueryByRunId.mockRejectedValue(notFound);

      await expect(invoke(event(message, lastAttempt))).rejects.toBe(notFound);

      expect(mockRecordRunCostCaptureFailure).toHaveBeenCalledWith(
        expect.objectContaining({ LaboratoryId: LAB_ID, RunId: RUN_ID }),
      );
    });

    it('logs a failed marker write and still throws the original error', async () => {
      const captureError = new Error('ThrottlingException');
      const markerError = new Error('DynamoDB unavailable');
      mockCapture.mockRejectedValue(captureError);
      mockRecordRunCostCaptureFailure.mockRejectedValue(markerError);

      await expect(invoke(event(message, lastAttempt))).rejects.toBe(captureError);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`RunId=${RUN_ID}`), markerError);
    });

    it.each([['1'], ['2'], [undefined], ['not-a-number']])(
      'records no marker when the receive count is %s',
      async (receiveCount) => {
        mockCapture.mockRejectedValue(new Error('ThrottlingException'));

        await expect(invoke(event(message, receiveCount))).rejects.toThrow('ThrottlingException');

        expect(mockRecordRunCostCaptureFailure).not.toHaveBeenCalled();
      },
    );
  });
});
