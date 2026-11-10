import { LaboratorySchema } from './laboratory';
import { LaboratoryRunLimitsSchema, RunLimitHitSchema, RunLimitVerdictSchema } from './laboratory-run-limits';
import {
  RunCostEstimateFailedError,
  RunCostLimitExceededError,
  RunSampleLimitExceededError,
  RunSamplesNotCountedError,
} from '../../utils/HttpError';

describe('LaboratoryRunLimitsSchema', () => {
  it.each([
    ['no limits', {}],
    ['all four limits', { CostWarnAboveUsd: 150, CostBlockAboveUsd: 400, SamplesWarnAbove: 300, SamplesBlockAbove: 500 }],
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

describe('RunLimitVerdictSchema', () => {
  it('accepts a block verdict with a cost hit', () => {
    const hit = { limit: 'cost', level: 'block', amount: 400, runValue: 470 };
    expect(RunLimitHitSchema.safeParse(hit).success).toBe(true);
    expect(RunLimitVerdictSchema.safeParse({ outcome: 'block', hits: [hit], costEstimate: 'available' }).success).toBe(
      true,
    );
  });

  it('rejects an unknown outcome', () => {
    expect(RunLimitVerdictSchema.safeParse({ outcome: 'stop', hits: [], costEstimate: 'available' }).success).toBe(
      false,
    );
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
