import { fetchRedactedLogExcerpt } from '../../../../src/app/services/llm-classification/run-log-fetcher';

describe('fetchRedactedLogExcerpt', () => {
  let getLogStreamText: jest.Mock;
  let deps: any;

  beforeEach(() => {
    getLogStreamText = jest.fn();
    deps = { cloudWatchLogsService: { getLogStreamText } };
  });

  const healthOmicsRun = {
    RunId: 'run-1',
    Platform: 'AWS HealthOmics',
    ExternalRunId: '4399444',
  } as any;

  it('reads the deterministic HealthOmics engine stream and returns a redacted excerpt', async () => {
    getLogStreamText.mockResolvedValue(
      'progress\nCaused by: OutOfMemoryError for s3://bucket/patientA/reads.bam at 10.0.0.5',
    );

    const excerpt = await fetchRedactedLogExcerpt(healthOmicsRun, deps);

    expect(getLogStreamText).toHaveBeenCalledWith('/aws/omics/WorkflowLog', 'run/4399444/engine');
    expect(excerpt).toContain('OutOfMemoryError');
    expect(excerpt).not.toContain('s3://');
    expect(excerpt).not.toContain('10.0.0.5');
  });

  it('returns undefined for non-HealthOmics platforms (Seqera log fetch not implemented)', async () => {
    const excerpt = await fetchRedactedLogExcerpt({ ...healthOmicsRun, Platform: 'Seqera Cloud' }, deps);
    expect(excerpt).toBeUndefined();
    expect(getLogStreamText).not.toHaveBeenCalled();
  });

  it('returns undefined (best-effort) when the log fetch throws', async () => {
    getLogStreamText.mockRejectedValue(new Error('AccessDenied'));
    const excerpt = await fetchRedactedLogExcerpt(healthOmicsRun, deps);
    expect(excerpt).toBeUndefined();
  });

  it('returns undefined when the run has no ExternalRunId', async () => {
    const excerpt = await fetchRedactedLogExcerpt({ ...healthOmicsRun, ExternalRunId: undefined }, deps);
    expect(excerpt).toBeUndefined();
    expect(getLogStreamText).not.toHaveBeenCalled();
  });

  it('returns undefined when the engine stream is empty', async () => {
    getLogStreamText.mockResolvedValue('');
    const excerpt = await fetchRedactedLogExcerpt(healthOmicsRun, deps);
    expect(excerpt).toBeUndefined();
  });
});
