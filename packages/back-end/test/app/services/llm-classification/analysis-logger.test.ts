import { logAnalysisEvent } from '../../../../src/app/services/llm-classification/analysis-logger';

describe('logAnalysisEvent', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(line));
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits a single line of valid JSON', () => {
    logAnalysisEvent({
      runId: 'r1',
      laboratoryId: 'l1',
      organizationId: 'o1',
      platform: 'AWS HealthOmics',
      trigger: 'Manual',
      outcome: 'succeeded',
      durationMs: 12,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain('\n');
    expect(JSON.parse(logged[0])).toMatchObject({
      event: 'failure-analysis',
      runId: 'r1',
      outcome: 'succeeded',
      durationMs: 12,
    });
  });

  it('omits undefined fields rather than emitting nulls', () => {
    logAnalysisEvent({
      runId: 'r1',
      laboratoryId: 'l1',
      organizationId: 'o1',
      platform: 'Seqera Cloud',
      trigger: 'Automatic',
      outcome: 'skipped',
      durationMs: 0,
    });
    const parsed = JSON.parse(logged[0]);
    expect('errorCode' in parsed).toBe(false);
    expect('modelId' in parsed).toBe(false);
  });
});
