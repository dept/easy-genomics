import {
  costLimitsOrderError,
  resolveCostLimits,
  workflowAccessPlatformForRun,
  workflowRunLimitsKey,
  workflowRunLimitsKeyForRun,
} from './workflow-run-limits';

describe('resolveCostLimits', () => {
  it('takes each field from the workflow when set and from the lab otherwise', () => {
    expect(resolveCostLimits({ CostWarnAboveUsd: 150, CostBlockAboveUsd: 400 }, { CostBlockAboveUsd: 800 })).toEqual({
      warnAbove: { amount: 150, source: 'lab' },
      blockAbove: { amount: 800, source: 'workflow' },
    });
  });

  it('ignores the lab sample amounts', () => {
    expect(resolveCostLimits({ SamplesWarnAbove: 10, SamplesBlockAbove: 20 }, undefined)).toEqual({});
  });

  it('returns no amounts when neither side sets them', () => {
    expect(resolveCostLimits(undefined, undefined)).toEqual({});
  });
});

describe('costLimitsOrderError', () => {
  it('names both amounts and where they come from when block is not above warn', () => {
    expect(
      costLimitsOrderError(resolveCostLimits({ CostBlockAboveUsd: 400 }, { CostWarnAboveUsd: 500 }), 'nf-core/rnaseq'),
    ).toBe(
      "For nf-core/rnaseq, block above (US$400, the lab's) must be higher than warn above (US$500, the workflow's) for estimated cost per run.",
    );
  });

  it('formats a fractional amount with cents', () => {
    expect(
      costLimitsOrderError(resolveCostLimits({ CostBlockAboveUsd: 99 }, { CostWarnAboveUsd: 99.5 }), 'taxprofiler'),
    ).toBe(
      "For taxprofiler, block above (US$99.00, the lab's) must be higher than warn above (US$99.50, the workflow's) for estimated cost per run.",
    );
  });

  it('rejects equal amounts', () => {
    expect(
      costLimitsOrderError(resolveCostLimits({ CostWarnAboveUsd: 400 }, { CostBlockAboveUsd: 400 }), 'x'),
    ).not.toBeNull();
  });

  it.each([
    ['block above warn', resolveCostLimits({ CostWarnAboveUsd: 150 }, { CostBlockAboveUsd: 800 })],
    ['only a warn amount', resolveCostLimits({ CostWarnAboveUsd: 150 }, undefined)],
    ['only a block amount', resolveCostLimits(undefined, { CostBlockAboveUsd: 800 })],
    ['no amounts', resolveCostLimits(undefined, undefined)],
  ])('passes with %s', (_label, resolved) => {
    expect(costLimitsOrderError(resolved, 'nf-core/rnaseq')).toBeNull();
  });
});

describe('workflowRunLimitsKey', () => {
  it('builds the key the workflow access table uses', () => {
    expect(workflowRunLimitsKey('SEQERA', '42')).toBe('SEQERA#42');
  });
});

describe('workflowRunLimitsKeyForRun', () => {
  it('maps a HealthOmics run to the stored key', () => {
    expect(workflowRunLimitsKeyForRun('AWS HealthOmics', '5734690')).toBe('HEALTH_OMICS#5734690');
  });

  it('maps a Seqera run to the stored key', () => {
    expect(workflowRunLimitsKeyForRun('Seqera Cloud', '42')).toBe('SEQERA#42');
  });
});

describe('workflowAccessPlatformForRun', () => {
  it('maps each run platform to its access platform', () => {
    expect(workflowAccessPlatformForRun('AWS HealthOmics')).toBe('HEALTH_OMICS');
    expect(workflowAccessPlatformForRun('Seqera Cloud')).toBe('SEQERA');
  });

  it.each(['', 'HEALTH_OMICS', 'toString', 'Other Cloud'])('returns undefined for %p', (platform) => {
    expect(workflowAccessPlatformForRun(platform)).toBeUndefined();
  });
});
