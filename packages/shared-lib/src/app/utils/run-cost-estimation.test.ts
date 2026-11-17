import { calculateHealthOmicsComputeCostUsd, calculateHealthOmicsStorageCostUsd } from './healthomics-cost-calculator';
import {
  countSamplesInSampleSheetCsv,
  estimateComputeCostBand,
  hashRunSettings,
  scaleCostToSampleCount,
  similarityScore,
} from './run-cost-estimation';

describe('healthomics-cost-calculator', () => {
  it('applies 60-second minimum and skips cache hits', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const stopEarly = new Date('2026-01-01T00:00:10Z'); // 10s -> billed as 60s
    const stopHour = new Date('2026-01-01T01:00:00Z');

    const cost = calculateHealthOmicsComputeCostUsd(
      [
        {
          instanceType: 'omics.c.large',
          startTime: start,
          stopTime: stopEarly,
          status: 'COMPLETED',
          cacheHit: false,
        },
        {
          instanceType: 'omics.c.large',
          startTime: start,
          stopTime: stopHour,
          status: 'COMPLETED',
          cacheHit: true, // excluded
        },
        {
          instanceType: 'omics.c.large',
          startTime: start,
          stopTime: stopHour,
          status: 'FAILED', // excluded
          cacheHit: false,
        },
      ],
      'us-east-1',
    );

    // omics.c.large = $0.1092/hr; 60s = 0.1092/60 = 0.00182
    expect(cost).toBeCloseTo(0.00182, 4);
  });

  it('estimates static storage cost', () => {
    const cost = calculateHealthOmicsStorageCostUsd(
      {
        storageType: 'STATIC',
        storageCapacity: 1200,
        startTime: '2026-01-01T00:00:00Z',
        stopTime: '2026-01-01T10:00:00Z',
      },
      'us-east-1',
    );
    // 1200 GiB * 10h * 0.000274 = 3.288
    expect(cost).toBeCloseTo(3.288, 3);
  });
});

describe('run-cost-estimation', () => {
  it('hashes settings canonically regardless of key order', () => {
    expect(hashRunSettings({ a: 1, b: 2 })).toBe(hashRunSettings({ b: 2, a: 1 }));
  });

  it('counts sample sheet rows excluding header', () => {
    expect(countSamplesInSampleSheetCsv('sample,fastq_1\ns1,a.fq\ns2,b.fq\n')).toBe(2);
  });

  it('returns zero samples for empty or header-only CSV', () => {
    expect(countSamplesInSampleSheetCsv('')).toBe(0);
    expect(countSamplesInSampleSheetCsv('sample,fastq_1\n')).toBe(0);
    expect(countSamplesInSampleSheetCsv('\n\n')).toBe(0);
  });

  it('returns unavailable when fewer than 3 comparable runs', () => {
    const band = estimateComputeCostBand({ SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc' }, [
      { ActualComputeCostUsd: 5, SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc' },
      { ActualComputeCostUsd: 6, SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc' },
    ]);
    expect(band.estimateAvailable).toBe(false);
    expect(band.confidence).toBe('NONE');
  });

  it('returns a MEDIUM band for exactly 3 tight comparable runs', () => {
    const candidates = [5, 5.5, 6].map((ActualComputeCostUsd) => ({
      ActualComputeCostUsd,
      SampleCount: 10,
      InputBytesTotal: 1e9,
      ParameterHash: 'abc',
      WorkflowVersionName: 'v1',
    }));
    const band = estimateComputeCostBand(
      { SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc', WorkflowVersionName: 'v1' },
      candidates,
    );
    expect(band.estimateAvailable).toBe(true);
    expect(band.confidence).toBe('MEDIUM');
    expect(band.comparableRunCount).toBe(3);
    expect(band.computeCostUsd).toEqual({ low: 5.25, median: 5.5, high: 5.75 });
  });

  it('returns a HIGH band for 7 same-version low-spread runs', () => {
    const candidates = [4.9, 4.95, 5, 5, 5.05, 5.1, 5.15].map((ActualComputeCostUsd) => ({
      ActualComputeCostUsd,
      SampleCount: 10,
      InputBytesTotal: 1e9,
      ParameterHash: 'abc',
      WorkflowVersionName: 'v1',
    }));
    const band = estimateComputeCostBand(
      { SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc', WorkflowVersionName: 'v1' },
      candidates,
    );
    expect(band.estimateAvailable).toBe(true);
    expect(band.confidence).toBe('HIGH');
    expect(band.comparableRunCount).toBe(7);
  });

  it('returns unavailable for empty candidates or zero sample/bytes profiles', () => {
    expect(
      estimateComputeCostBand({ SampleCount: 0, InputBytesTotal: 0, ParameterHash: 'abc' }, []).estimateAvailable,
    ).toBe(false);

    const band = estimateComputeCostBand({ SampleCount: 0, InputBytesTotal: 0, ParameterHash: 'abc' }, [
      { ActualComputeCostUsd: 5, SampleCount: 0, InputBytesTotal: 0, ParameterHash: 'abc' },
      { ActualComputeCostUsd: 6, SampleCount: 0, InputBytesTotal: 0, ParameterHash: 'abc' },
      { ActualComputeCostUsd: 7, SampleCount: 0, InputBytesTotal: 0, ParameterHash: 'abc' },
    ]);
    // Zero inputs still produce a band when enough identical candidates exist (log-ratio floors at 1).
    expect(band.comparableRunCount).toBe(3);
  });

  it('returns a p25-p75 band for similar historical runs', () => {
    const candidates = [4, 5, 5.5, 6, 7, 8, 9].map((ActualComputeCostUsd) => ({
      ActualComputeCostUsd,
      SampleCount: 10,
      InputBytesTotal: 1e9,
      ParameterHash: 'abc',
      WorkflowVersionName: 'v1',
    }));
    const band = estimateComputeCostBand(
      { SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc', WorkflowVersionName: 'v1' },
      candidates,
    );
    expect(band.estimateAvailable).toBe(true);
    expect(band.computeCostUsd).toBeDefined();
    expect(band.computeCostUsd!.low).toBeLessThanOrEqual(band.computeCostUsd!.median);
    expect(band.computeCostUsd!.median).toBeLessThanOrEqual(band.computeCostUsd!.high);
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(band.confidence);
  });

  it('scores identical profiles near zero', () => {
    const score = similarityScore(
      { SampleCount: 8, InputBytesTotal: 2e9, ParameterHash: 'x', WorkflowVersionName: 'v1' },
      {
        ActualComputeCostUsd: 1,
        SampleCount: 8,
        InputBytesTotal: 2e9,
        ParameterHash: 'x',
        WorkflowVersionName: 'v1',
      },
    );
    expect(score).toBe(0);
  });
});

describe('estimateComputeCostBand sample scaling', () => {
  // Bytes grow with samples so the similarity score is realistic: 10x size costs
  // 0.8 (samples) + 0.6 (bytes) = 1.4 of the 1.5 budget.
  const hist = (cost: number, samples?: number) => ({
    ActualComputeCostUsd: cost,
    SampleCount: samples,
    InputBytesTotal: (samples ?? 0) * 1_000,
    WorkflowVersionName: 'v1',
    ParameterHash: 'p',
    TerminalAt: new Date().toISOString(),
  });
  const profile = (samples: number) => ({
    SampleCount: samples,
    InputBytesTotal: samples * 1_000,
    ParameterHash: 'p',
    WorkflowVersionName: 'v1',
  });

  it('scales a 96-sample history to a 1,000-sample run', () => {
    const band = estimateComputeCostBand(
      profile(1000),
      Array.from({ length: 5 }, () => hist(40, 96)),
    );
    expect(band.estimateAvailable).toBe(true);
    expect(band.computeCostUsd!.median).toBeCloseTo(416.67, 2);
  });

  it("gives today's estimate for a run the same size as the history", () => {
    const band = estimateComputeCostBand(
      profile(96),
      Array.from({ length: 5 }, () => hist(40, 96)),
    );
    expect(band.computeCostUsd!.median).toBe(40);
  });

  it("falls back to whole-run cost when the past run's sample count is 0 or missing", () => {
    const band = estimateComputeCostBand(profile(10), [hist(40, 0), hist(40, undefined), hist(40, 0)]);
    expect(band.estimateAvailable).toBe(true);
    expect(band.computeCostUsd!.median).toBe(40);
  });

  it("falls back to whole-run cost when this run's sample count is 0", () => {
    const band = estimateComputeCostBand(
      profile(0),
      Array.from({ length: 3 }, () => hist(40, 96)),
    );
    expect(band.estimateAvailable).toBe(true);
    expect(band.computeCostUsd!.median).toBe(40);
  });

  it('has no estimate for a 10x run on a different workflow version (pins current scoring)', () => {
    const band = estimateComputeCostBand(
      { ...profile(1000), WorkflowVersionName: 'v2' },
      Array.from({ length: 5 }, () => hist(40, 96)),
    );
    expect(band.estimateAvailable).toBe(false);
  });

  describe('scaleCostToSampleCount', () => {
    it('scales cost per sample to the run sample count', () => {
      expect(scaleCostToSampleCount(40, 96, 1000)).toBeCloseTo(416.67, 2);
    });

    it.each([
      [0, 1000],
      [undefined, 1000],
      [96, 0],
    ])('returns the whole-run cost when historical=%p and run=%p', (historicalSampleCount, runSampleCount) => {
      expect(scaleCostToSampleCount(40, historicalSampleCount, runSampleCount)).toBe(40);
    });
  });
});
