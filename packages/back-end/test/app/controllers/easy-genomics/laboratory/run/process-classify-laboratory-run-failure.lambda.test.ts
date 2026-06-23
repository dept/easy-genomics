import { SQSEvent, SQSRecord } from 'aws-lambda/trigger/sqs';

// Shared jest.fn instances captured by the LLMClassificationService factory mock.
// Defined as `var` so the hoisted jest.mock() factory can reference them — `let`/`const`
// would be in the temporal dead zone when the factory runs.
// eslint-disable-next-line no-var
var mockClassify: jest.Mock;
mockClassify = jest.fn();

// eslint-disable-next-line no-var
var mockFetchRedactedLogExcerpt: jest.Mock;
mockFetchRedactedLogExcerpt = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/ssm-service');
jest.mock('../../../../../../src/app/services/cloudwatch-logs-service');
jest.mock('../../../../../../src/app/services/llm-classification/run-log-fetcher', () => ({
  fetchRedactedLogExcerpt: mockFetchRedactedLogExcerpt,
}));
jest.mock('../../../../../../src/app/services/llm-classification/llm-classification-service', () => ({
  LLMClassificationService: jest.fn().mockImplementation(() => ({
    classify: mockClassify,
  })),
}));

import {
  handler,
  processClassificationEvent,
} from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-classify-laboratory-run-failure.lambda';
import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { SsmService } from '../../../../../../src/app/services/ssm-service';

describe('process-classify-laboratory-run-failure.lambda', () => {
  let mockQueryByRunId: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockGetParameter: jest.Mock;

  const createEvent = (records: SQSRecord[]): SQSEvent =>
    ({
      Records: records,
    }) as any;

  const buildSqsRecord = (record: any): SQSRecord =>
    ({
      body: JSON.stringify({
        Message: JSON.stringify({ Operation: 'UPDATE', Type: 'LaboratoryRun', Record: record }),
      }),
    }) as any;

  // Per-integration provider config: HealthOmics uses Bedrock (no key needed),
  // Seqera uses OpenAI (key needed). Setting a provider IS the enable signal —
  // no separate toggle.
  const labMixedProviders = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    Name: 'Lab 1',
    Status: 'Active' as const,
    HealthOmicsLlmProvider: 'bedrock' as const,
    HealthOmicsLlmModelId: 'anthropic.claude-haiku-4-5-20251001',
    SeqeraLlmProvider: 'openai' as const,
    SeqeraLlmModelId: 'gpt-4o-mini',
  };

  beforeEach(() => {
    mockClassify.mockReset();
    mockFetchRedactedLogExcerpt.mockReset();
    mockFetchRedactedLogExcerpt.mockResolvedValue(undefined);
    mockQueryByRunId = jest.fn();
    mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockQueryByLaboratoryId = jest.fn().mockResolvedValue(labMixedProviders);
    mockGetParameter = jest.fn().mockResolvedValue({ Parameter: { Value: 'sk-seqera-key' } });

    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.queryByRunId = mockQueryByRunId;
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.update = mockUpdate;
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId =
      mockQueryByLaboratoryId;
    (SsmService as jest.MockedClass<typeof SsmService>).prototype.getParameter = mockGetParameter;
  });

  it('uses the deterministic lookup for documented HealthOmics codes (no LLM call, no SSM)', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'OUT_OF_MEMORY_ERROR',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockGetParameter).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ FailureOwner: 'Bioinformatician', FailureClassifiedBy: 'lookup' }),
    );
  });

  it('HealthOmics ambiguous failure dispatches to the lab HealthOmics provider (Bedrock, no SSM read)', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'WORKFLOW_RUN_FAILED',
    });
    mockClassify.mockResolvedValue({
      owner: 'Ambiguous',
      summary: 'Engine failure',
      action: 'Check CloudWatch',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockGetParameter).not.toHaveBeenCalled();
    const config = mockClassify.mock.calls[0][1];
    expect(config.provider).toBe('bedrock');
    expect(config.modelId).toBe('anthropic.claude-haiku-4-5-20251001');
    expect(config.apiKey).toBeUndefined();
  });

  it('Seqera failure dispatches to the lab Seqera provider (OpenAI, reads Seqera-scoped SSM key)', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'Seqera Cloud',
      Status: 'FAILED',
      FailureReason: 'Process SAMPLESHEET_CHECK failed',
    });
    mockClassify.mockResolvedValue({
      owner: 'Lab',
      summary: 'Sample sheet invalid',
      action: 'Re-upload',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockGetParameter).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: '/easy-genomics/organization/org-1/laboratory/lab-1/llm-api-key-seqera',
        WithDecryption: true,
      }),
    );
    const config = mockClassify.mock.calls[0][1];
    expect(config.provider).toBe('openai');
    expect(config.modelId).toBe('gpt-4o-mini');
    expect(config.apiKey).toBe('sk-seqera-key');
  });

  it('passes the HealthOmics statusMessage as distinct context, not a duplicate of FailureReason', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'WORKFLOW_RUN_FAILED',
      FailureStatusMessage: 'Task RNASEQ:FASTQC failed — see /aws/omics/run/123 logs',
    });
    mockClassify.mockResolvedValue({ owner: 'Ambiguous', summary: 's', action: 'a' });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    const input = mockClassify.mock.calls[0][0];
    expect(input.failureReason).toBe('WORKFLOW_RUN_FAILED');
    expect(input.statusMessage).toBe('Task RNASEQ:FASTQC failed — see /aws/omics/run/123 logs');
    expect(input.errorMessage).toBeUndefined();
    expect(input.errorReport).toBeUndefined();
  });

  it('passes the Seqera errorReport as distinct context alongside the errorMessage', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'Seqera Cloud',
      Status: 'FAILED',
      FailureReason: 'Process SAMPLESHEET_CHECK failed',
      FailureErrorReport: 'Caused by:\n  Missing required column "sample"',
    });
    mockClassify.mockResolvedValue({ owner: 'Lab', summary: 's', action: 'a' });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    const input = mockClassify.mock.calls[0][0];
    expect(input.errorMessage).toBe('Process SAMPLESHEET_CHECK failed');
    expect(input.errorReport).toBe('Caused by:\n  Missing required column "sample"');
    expect(input.failureReason).toBeUndefined();
    expect(input.statusMessage).toBeUndefined();
  });

  it('reads HealthOmics-scoped SSM key when HealthOmics is configured with OpenAI', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      ...labMixedProviders,
      HealthOmicsLlmProvider: 'openai',
      HealthOmicsLlmModelId: 'gpt-4o-mini',
    });
    mockGetParameter.mockResolvedValue({ Parameter: { Value: 'sk-omics-key' } });
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'WORKFLOW_RUN_FAILED',
    });
    mockClassify.mockResolvedValue({ owner: 'Ambiguous', summary: 's', action: 'a' });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockGetParameter).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: '/easy-genomics/organization/org-1/laboratory/lab-1/llm-api-key-healthomics',
      }),
    );
    expect(mockClassify.mock.calls[0][1].apiKey).toBe('sk-omics-key');
  });

  it('skips when the integration toggle is on but the integration has no provider configured', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      ...labMixedProviders,
      SeqeraLlmProvider: undefined,
      SeqeraLlmModelId: undefined,
    });
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'Seqera Cloud',
      Status: 'FAILED',
      FailureReason: 'something',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockGetParameter).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips OpenAI when the integration-scoped SSM key is missing', async () => {
    mockGetParameter.mockResolvedValue({ Parameter: undefined });
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'Seqera Cloud',
      Status: 'FAILED',
      FailureReason: 'something',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('still uses the deterministic lookup for HealthOmics even when no provider is configured', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      ...labMixedProviders,
      HealthOmicsLlmProvider: undefined,
      HealthOmicsLlmModelId: undefined,
      SeqeraLlmProvider: undefined,
      SeqeraLlmModelId: undefined,
    });
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'OUT_OF_MEMORY_ERROR',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ FailureOwner: 'Bioinformatician', FailureClassifiedBy: 'lookup' }),
    );
  });

  it('does NOT call the LLM for ambiguous HealthOmics codes when HealthOmics provider is unset', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({
      ...labMixedProviders,
      HealthOmicsLlmProvider: undefined,
      HealthOmicsLlmModelId: undefined,
    });
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'WORKFLOW_RUN_FAILED',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockClassify).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does NOT fetch logs when the enrichment toggle is off (HealthOmics LLM path)', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'WORKFLOW_RUN_FAILED',
    });
    mockClassify.mockResolvedValue({ owner: 'Ambiguous', summary: 's', action: 'a' });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockFetchRedactedLogExcerpt).not.toHaveBeenCalled();
    expect(mockClassify.mock.calls[0][0].logExcerpt).toBeUndefined();
  });

  it('fetches a redacted log excerpt and passes it to the LLM when the toggle is on', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({ ...labMixedProviders, HealthOmicsLogEnrichmentEnabled: true });
    mockFetchRedactedLogExcerpt.mockResolvedValue('Caused by: OutOfMemoryError in task FOO');
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'WORKFLOW_RUN_FAILED',
    });
    mockClassify.mockResolvedValue({ owner: 'Bioinformatician', summary: 'OOM', action: 'Raise memory' });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockFetchRedactedLogExcerpt).toHaveBeenCalled();
    expect(mockClassify.mock.calls[0][0].logExcerpt).toBe('Caused by: OutOfMemoryError in task FOO');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ FailureClassifiedBy: 'llm' }));
  });

  it('enriches even a lookup-matched HealthOmics code when the toggle is on', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({ ...labMixedProviders, HealthOmicsLogEnrichmentEnabled: true });
    mockFetchRedactedLogExcerpt.mockResolvedValue('task FASTQC OOM-killed');
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'OUT_OF_MEMORY_ERROR', // present in the deterministic lookup
    });
    mockClassify.mockResolvedValue({ owner: 'Bioinformatician', summary: 'FASTQC OOM', action: 'Raise memory' });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockClassify).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ FailureSummary: 'FASTQC OOM', FailureClassifiedBy: 'llm' }),
    );
  });

  it('falls back to the deterministic lookup when the enriched LLM call yields nothing usable', async () => {
    mockQueryByLaboratoryId.mockResolvedValue({ ...labMixedProviders, HealthOmicsLogEnrichmentEnabled: true });
    mockFetchRedactedLogExcerpt.mockResolvedValue('some logs');
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'OUT_OF_MEMORY_ERROR',
    });
    mockClassify.mockResolvedValue({ owner: 'Ambiguous', summary: '', action: '' }); // unusable fallback

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ FailureOwner: 'Bioinformatician', FailureClassifiedBy: 'lookup' }),
    );
  });

  it('is idempotent when FailureOwner already set', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'OUT_OF_MEMORY_ERROR',
      FailureOwner: 'Bioinformatician',
    });

    await processClassificationEvent('UPDATE', { RunId: 'run-1' } as any);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockQueryByLaboratoryId).not.toHaveBeenCalled();
  });

  it('rejects non-UPDATE operations', async () => {
    const result = await processClassificationEvent('DELETE' as any, { RunId: 'run-1' } as any);
    expect(result).toBe(false);
  });

  it('handler iterates SQS records and returns 200', async () => {
    mockQueryByRunId.mockResolvedValue({
      RunId: 'run-1',
      LaboratoryId: 'lab-1',
      Platform: 'AWS HealthOmics',
      Status: 'FAILED',
      FailureReason: 'OUT_OF_MEMORY_ERROR',
    });
    const event = createEvent([buildSqsRecord({ RunId: 'run-1' })]);
    const result = await handler(event, {} as any, () => {});
    expect(result.statusCode).toBe(200);
  });
});
