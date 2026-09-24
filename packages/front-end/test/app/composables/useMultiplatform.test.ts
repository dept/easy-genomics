import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';

import { useMultiplatform } from '../../../src/app/composables/useMultiplatform';

const mockUpdateWipOmicsRun = jest.fn();
const mockUpdateWipOmicsRunParams = jest.fn();
const mockUpdateWipSeqeraRun = jest.fn();
const mockUpdateWipSeqeraRunParams = jest.fn();

const wipOmicsRuns: Record<string, { runName?: string }> = {
  'omics-temp-1': { runName: 'Omics WIP' },
};
const wipSeqeraRuns: Record<string, { runName?: string }> = {
  'seqera-temp-1': { runName: 'Seqera WIP' },
};

// useMultiplatform relies on Nuxt auto-imported useRunStore (no explicit import).
(global as any).useRunStore = () => ({
  updateWipOmicsRun: mockUpdateWipOmicsRun,
  updateWipOmicsRunParams: mockUpdateWipOmicsRunParams,
  updateWipSeqeraRun: mockUpdateWipSeqeraRun,
  updateWipSeqeraRunParams: mockUpdateWipSeqeraRunParams,
  wipOmicsRuns,
  wipSeqeraRuns,
});

describe('useMultiplatform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps AWS HealthOmics to Workflow', () => {
    const { platformToPipelineOrWorkflow } = useMultiplatform();
    expect(platformToPipelineOrWorkflow('AWS HealthOmics')).toBe('Workflow');
  });

  it('resolves HealthOmics WIP update functions to Omics store methods', () => {
    const { platformToWipRunUpdateFunction, platformToWipRunUpdateParamsFunction } = useMultiplatform();

    expect(platformToWipRunUpdateFunction('AWS HealthOmics')).toBe(mockUpdateWipOmicsRun);
    expect(platformToWipRunUpdateParamsFunction('AWS HealthOmics')).toBe(mockUpdateWipOmicsRunParams);
  });

  it('reads HealthOmics WIP runs from wipOmicsRuns', () => {
    const { getWipRunForPlatform } = useMultiplatform();
    expect(getWipRunForPlatform('AWS HealthOmics', 'omics-temp-1')).toEqual({ runName: 'Omics WIP' });
  });

  it('throws for an invalid platform', () => {
    const { platformToPipelineOrWorkflow, platformToWipRunUpdateFunction, getWipRunForPlatform } = useMultiplatform();
    const invalid = 'Not A Platform' as RunType;

    expect(() => platformToPipelineOrWorkflow(invalid)).toThrow(/not a valid platform/);
    expect(() => platformToWipRunUpdateFunction(invalid)).toThrow(/not a valid platform/);
    expect(() => getWipRunForPlatform(invalid, 'x')).toThrow(/not a valid platform/);
  });

  it('throws when HealthOmics WIP run id is missing', () => {
    const { getWipRunForPlatform } = useMultiplatform();
    expect(() => getWipRunForPlatform('AWS HealthOmics', 'missing-id')).toThrow(
      /no WIP AWS HealthOmics run for id missing-id/,
    );
  });
});
