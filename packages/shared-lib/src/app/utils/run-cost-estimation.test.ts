import { calculateHealthOmicsComputeCostUsd, calculateHealthOmicsStorageCostUsd } from './healthomics-cost-calculator';
import {
  countSamplesInSampleSheetCsv,
  estimateComputeCostBand,
  hashRunSettings,
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

  it('returns unavailable when fewer than 3 comparable runs', () => {
    const band = estimateComputeCostBand({ SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc' }, [
      { ActualComputeCostUsd: 5, SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc' },
      { ActualComputeCostUsd: 6, SampleCount: 10, InputBytesTotal: 1e9, ParameterHash: 'abc' },
    ]);
    expect(band.estimateAvailable).toBe(false);
    expect(band.confidence).toBe('NONE');
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
