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

    const { excerpt, reason } = await fetchRedactedLogExcerpt(healthOmicsRun, deps);

    expect(getLogStreamText).toHaveBeenCalledWith('/aws/omics/WorkflowLog', 'run/4399444/engine', 1000);
    expect(excerpt).toContain('OutOfMemoryError');
    expect(excerpt).not.toContain('s3://');
    expect(excerpt).not.toContain('10.0.0.5');
    expect(reason).toEqual('log-excerpt');
  });

  it('reports log-no-error when the engine log carries no failure marker', async () => {
    // A run whose engine exited without reporting a cause: the excerpt is the
    // log tail, which proves nothing on its own.
    getLogStreamText.mockResolvedValue('Launching `main.nf` [cheeky_dijkstra]\nPulling image\nStaging inputs');

    const { excerpt, reason } = await fetchRedactedLogExcerpt(healthOmicsRun, deps);

    expect(excerpt).toContain('Staging inputs');
    expect(reason).toEqual('log-no-error');
  });

  it('reports log-unavailable for non-HealthOmics platforms (Seqera log fetch not implemented)', async () => {
    const { excerpt, reason } = await fetchRedactedLogExcerpt({ ...healthOmicsRun, Platform: 'Seqera Cloud' }, deps);
    expect(excerpt).toBeUndefined();
    expect(reason).toEqual('log-unavailable');
    expect(getLogStreamText).not.toHaveBeenCalled();
  });

  it('reports log-unavailable (best-effort) when the log fetch throws', async () => {
    getLogStreamText.mockRejectedValue(new Error('AccessDenied'));
    const { excerpt, reason } = await fetchRedactedLogExcerpt(healthOmicsRun, deps);
    expect(excerpt).toBeUndefined();
    expect(reason).toEqual('log-unavailable');
  });

  it('reports log-unavailable when the run has no ExternalRunId', async () => {
    const { excerpt, reason } = await fetchRedactedLogExcerpt({ ...healthOmicsRun, ExternalRunId: undefined }, deps);
    expect(excerpt).toBeUndefined();
    expect(reason).toEqual('log-unavailable');
    expect(getLogStreamText).not.toHaveBeenCalled();
  });

  it('reports log-unavailable when the engine stream is empty', async () => {
    getLogStreamText.mockResolvedValue('');
    const { excerpt, reason } = await fetchRedactedLogExcerpt(healthOmicsRun, deps);
    expect(excerpt).toBeUndefined();
    expect(reason).toEqual('log-unavailable');
  });
});
