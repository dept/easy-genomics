import { LaboratorySchema } from './laboratory';
import { EstimateRunCostResponseSchema } from './laboratory-run-cost';
import {
  LaboratoryRunLimitsSchema,
  RunLimitHitSchema,
  RunLimitVerdictSchema,
  UpdateLaboratoryWorkflowRunLimitsSchema,
} from './laboratory-run-limits';
import {
  RunCostEstimateFailedError,
  RunCostLimitExceededError,
  RunSampleLimitExceededError,
  RunSamplesNotCountedError,
} from '../../utils/HttpError';

describe('LaboratoryRunLimitsSchema', () => {
  it.each([
    ['no limits', {}],
    [
      'all four limits',
      { CostWarnAboveUsd: 150, CostBlockAboveUsd: 400, SamplesWarnAbove: 300, SamplesBlockAbove: 500 },
    ],
    ['a single limit', { SamplesBlockAbove: 500 }],
  ])('accepts %s', (_label, limits) => {
    expect(LaboratoryRunLimitsSchema.safeParse(limits).success).toBe(true);
  });

  it.each([
    [
      'cost',
      { CostWarnAboveUsd: 400, CostBlockAboveUsd: 400 },
      'CostBlockAboveUsd',
      'Block above must be higher than warn above for estimated cost per run.',
    ],
    [
      'samples',
      { SamplesWarnAbove: 500, SamplesBlockAbove: 300 },
      'SamplesBlockAbove',
      'Block above must be higher than warn above for samples per run.',
    ],
  ])('rejects a %s block amount that is not higher than its warn amount', (_label, limits, field, message) => {
    const result = LaboratoryRunLimitsSchema.safeParse(limits);
    expect(result.success).toBe(false);
    expect(result.error!.issues).toEqual([expect.objectContaining({ path: [field], message })]);
    expect(message).toContain('higher than');
  });

  it.each([
    ['a negative amount', { CostWarnAboveUsd: -1 }],
    ['a zero amount', { CostBlockAboveUsd: 0 }],
    ['a string amount', { CostBlockAboveUsd: '400' }],
    ['a fractional sample amount', { SamplesBlockAbove: 2.5 }],
    ['an unknown key', { Foo: 1 }],
    ['null', null],
  ])('rejects %s', (_label, limits) => {
    expect(LaboratoryRunLimitsSchema.safeParse(limits).success).toBe(false);
  });
});

describe('LaboratorySchema RunLimits', () => {
  const laboratory = {
    OrganizationId: '11111111-2222-4333-8444-555555555555',
    LaboratoryId: '66666666-7777-4888-9999-000000000000',
    Name: 'Lab',
    Status: 'Active',
  };

  it('accepts a laboratory without RunLimits', () => {
    expect(LaboratorySchema.safeParse(laboratory).success).toBe(true);
  });

  it('accepts a laboratory with RunLimits', () => {
    expect(LaboratorySchema.safeParse({ ...laboratory, RunLimits: { SamplesBlockAbove: 500 } }).success).toBe(true);
  });
});

describe('UpdateLaboratoryWorkflowRunLimitsSchema', () => {
  const base = { Platform: 'HEALTH_OMICS', WorkflowId: '5734690', WorkflowName: 'nf-core/rnaseq' };

  it.each([
    ['both amounts', { ...base, CostWarnAboveUsd: 300, CostBlockAboveUsd: 800 }],
    ['one amount', { ...base, CostBlockAboveUsd: 800 }],
    ['no amounts (clears the workflow)', base],
  ])('accepts %s', (_label, body) => {
    expect(UpdateLaboratoryWorkflowRunLimitsSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['block not above warn', { ...base, CostWarnAboveUsd: 800, CostBlockAboveUsd: 800 }],
    ['a negative amount', { ...base, CostWarnAboveUsd: -1 }],
    ['a string amount', { ...base, CostWarnAboveUsd: '300' }],
    ['a sample amount', { ...base, SamplesBlockAbove: 10 }],
    ['an unknown platform', { ...base, Platform: 'AWS HealthOmics' }],
    ['a workflow id with a #', { ...base, WorkflowId: 'a#b' }],
    ['a missing workflow name', { Platform: 'SEQERA', WorkflowId: '42' }],
  ])('rejects %s', (_label, body) => {
    expect(UpdateLaboratoryWorkflowRunLimitsSchema.safeParse(body).success).toBe(false);
  });

  it('uses the lab-level cost message when block is not above warn', () => {
    const result = UpdateLaboratoryWorkflowRunLimitsSchema.safeParse({
      ...base,
      CostWarnAboveUsd: 800,
      CostBlockAboveUsd: 800,
    });
    expect(result.error!.issues).toEqual([
      expect.objectContaining({
        path: ['CostBlockAboveUsd'],
        message: 'Block above must be higher than warn above for estimated cost per run.',
      }),
    ]);
  });
});

describe('LaboratorySchema WorkflowRunLimits', () => {
  const laboratory = {
    OrganizationId: '11111111-2222-4333-8444-555555555555',
    LaboratoryId: '66666666-7777-4888-9999-000000000000',
    Name: 'Lab',
    Status: 'Active',
  };

  it('accepts a lab with workflow limits', () => {
    const WorkflowRunLimits = { 'HEALTH_OMICS#5734690': { WorkflowName: 'nf-core/rnaseq', CostBlockAboveUsd: 800 } };
    expect(LaboratorySchema.safeParse({ ...laboratory, WorkflowRunLimits }).success).toBe(true);
  });

  it('rejects a workflow entry with a sample amount', () => {
    const WorkflowRunLimits = { 'HEALTH_OMICS#5734690': { WorkflowName: 'nf-core/rnaseq', SamplesBlockAbove: 10 } };
    expect(LaboratorySchema.safeParse({ ...laboratory, WorkflowRunLimits }).success).toBe(false);
  });
});

describe('RunLimitVerdictSchema', () => {
  it('accepts a block verdict with a cost hit', () => {
    const hit = { limit: 'cost', level: 'block', amount: 400, runValue: 470 };
    expect(RunLimitHitSchema.safeParse(hit).success).toBe(true);
    expect(RunLimitVerdictSchema.safeParse({ outcome: 'block', hits: [hit], costEstimate: 'available' }).success).toBe(
      true,
    );
  });

  it("accepts a cost hit whose amount is the workflow's", () => {
    const hit = { limit: 'cost', level: 'block', amount: 800, runValue: 900, amountSource: 'workflow' };
    expect(RunLimitHitSchema.safeParse(hit).success).toBe(true);
  });

  it('rejects an amountSource of "lab", since an absent amountSource means the lab\'s', () => {
    const hit = { limit: 'cost', level: 'block', amount: 400, runValue: 470, amountSource: 'lab' };
    expect(RunLimitHitSchema.safeParse(hit).success).toBe(false);
  });

  it('rejects an unknown outcome', () => {
    expect(RunLimitVerdictSchema.safeParse({ outcome: 'stop', hits: [], costEstimate: 'available' }).success).toBe(
      false,
    );
  });

  it('accepts a verdict whose cost estimate was not checked', () => {
    expect(RunLimitVerdictSchema.safeParse({ outcome: 'pass', hits: [], costEstimate: 'notChecked' }).success).toBe(
      true,
    );
  });

  it.each([96, 0])('accepts a counted sample count of %p', (sampleCount) => {
    const verdict = { outcome: 'pass', hits: [], costEstimate: 'notChecked', sampleCount };
    expect(RunLimitVerdictSchema.safeParse(verdict).success).toBe(true);
  });

  it.each([-1, 2.5, '96'])('rejects a sample count of %p', (sampleCount) => {
    const verdict = { outcome: 'pass', hits: [], costEstimate: 'notChecked', sampleCount };
    expect(RunLimitVerdictSchema.safeParse(verdict).success).toBe(false);
  });
});

describe('EstimateRunCostResponseSchema limitVerdict', () => {
  const unavailableEstimate = {
    estimateAvailable: false,
    confidence: 'NONE',
    comparableRunCount: 0,
    currency: 'USD',
    label: 'Estimate unavailable',
    disclaimer: 'Estimates are approximate.',
    exclusions: [],
  };

  it('accepts an estimate without a limit verdict', () => {
    expect(EstimateRunCostResponseSchema.safeParse(unavailableEstimate).success).toBe(true);
  });

  it('accepts an estimate with a limit verdict', () => {
    const limitVerdict = {
      outcome: 'block',
      hits: [{ limit: 'samples', level: 'block', amount: 500, runValue: 1000 }],
      costEstimate: 'notChecked',
    };
    expect(EstimateRunCostResponseSchema.safeParse({ ...unavailableEstimate, limitVerdict }).success).toBe(true);
  });

  it('rejects a malformed limit verdict', () => {
    expect(
      EstimateRunCostResponseSchema.safeParse({ ...unavailableEstimate, limitVerdict: { outcome: 'maybe' } }).success,
    ).toBe(false);
  });
});

describe('run limit errors', () => {
  it.each([
    [
      new RunCostLimitExceededError(470, 400),
      400,
      'EG-339',
      "Estimated run cost of $470.00 is above this laboratory's block amount of $400.00. Split the samples into smaller runs, or ask an organization admin to change the limit.",
    ],
    [
      new RunSampleLimitExceededError(620, 500),
      400,
      'EG-340',
      "This run has 620 samples, above this laboratory's limit of 500. Split the samples into smaller runs, or ask an organization admin to change the limit.",
    ],
    [
      new RunSamplesNotCountedError(),
      400,
      'EG-341',
      'The samples in this run could not be counted, and this laboratory has a sample limit. Check the sample sheet and try again.',
    ],
    [
      new RunCostEstimateFailedError(),
      500,
      'EG-342',
      'The run cost estimate failed, and this laboratory has a cost limit, so the run was not started. Try again shortly.',
    ],
  ])('%p has the expected status, code and message', (error, statusCode, errorCode, message) => {
    expect(error.statusCode).toBe(statusCode);
    expect(error.errorCode).toBe(errorCode);
    expect(error.message).toBe(message);
  });
});

describe('RunCostLimitExceededError amount source', () => {
  it("names the workflow's block amount", () => {
    expect(new RunCostLimitExceededError(900, 800, 'workflow').message).toBe(
      "Estimated run cost of $900.00 is above this workflow's block amount of $800.00. Split the samples into smaller runs, or ask an organization admin to change the limit.",
    );
  });

  it('keeps the lab wording by default', () => {
    expect(new RunCostLimitExceededError(470, 400).message).toContain(
      "above this laboratory's block amount of $400.00",
    );
  });
});
