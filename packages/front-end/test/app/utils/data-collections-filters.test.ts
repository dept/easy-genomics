import type {
  LaboratoryDataTag,
  LaboratoryRunUsageSummary,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import type { LaboratorySample } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
import {
  filterSamplesBySearch,
  isExpiringSoon,
  soonestExpiresAtForUsages,
} from '../../../src/app/utils/data-collections-filters';

const NOW = 1_777_000_000;
const DAY = 86_400;

function usage(runId: string, expiresAt?: number): LaboratoryRunUsageSummary {
  return {
    RunId: runId,
    RunName: `Run ${runId}`,
    ExpiresAt: expiresAt,
  } as LaboratoryRunUsageSummary;
}

describe('soonestExpiresAtForUsages', () => {
  it('returns undefined when usages is undefined or empty', () => {
    expect(soonestExpiresAtForUsages(undefined)).toBeUndefined();
    expect(soonestExpiresAtForUsages([])).toBeUndefined();
  });

  it('returns undefined when no usages carry an ExpiresAt (non-expiring lab)', () => {
    expect(soonestExpiresAtForUsages([usage('r1'), usage('r2')])).toBeUndefined();
  });

  it('returns the minimum ExpiresAt across mixed usages', () => {
    const result = soonestExpiresAtForUsages([
      usage('r1', NOW + 90 * DAY),
      usage('r2'),
      usage('r3', NOW + 10 * DAY),
      usage('r4', NOW + 45 * DAY),
    ]);
    expect(result).toBe(NOW + 10 * DAY);
  });
});

describe('isExpiringSoon', () => {
  it('always returns false for Permanent-tagged files even when very near expiry', () => {
    expect(
      isExpiringSoon({
        isPermanent: true,
        usages: [usage('r1', NOW + 1)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(false);
  });

  it('returns false when there are no recorded run usages', () => {
    expect(isExpiringSoon({ isPermanent: false, usages: undefined, thresholdDays: 30, nowEpoch: NOW })).toBe(false);
    expect(isExpiringSoon({ isPermanent: false, usages: [], thresholdDays: 30, nowEpoch: NOW })).toBe(false);
  });

  it('returns false when usages exist but none carry an ExpiresAt (non-expiring runs)', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1'), usage('r2')],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(false);
  });

  it('returns true when soonest ExpiresAt is within the threshold window', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW + 60 * DAY), usage('r2', NOW + 20 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(true);
  });

  it('returns false when the soonest ExpiresAt is beyond the threshold window', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW + 60 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(false);
  });

  it('returns true when ExpiresAt is already in the past (overdue but not yet swept)', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW - 5 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(true);
  });

  it('treats the threshold as inclusive (soonest - now === thresholdDays * 86400)', () => {
    expect(
      isExpiringSoon({
        isPermanent: false,
        usages: [usage('r1', NOW + 30 * DAY)],
        thresholdDays: 30,
        nowEpoch: NOW,
      }),
    ).toBe(true);
  });
});

function sample(id: string, name: string, batchTagId?: string): LaboratorySample {
  return {
    SampleId: id,
    Name: name,
    Layout: 'paired_end',
    FileCount: 1,
    BatchTagId: batchTagId,
  };
}

function tag(id: string, name: string, kind: LaboratoryDataTag['Kind'] = 'standard'): LaboratoryDataTag {
  return {
    TagId: id,
    Name: name,
    ColorHex: '#000000',
    Kind: kind,
    FileCount: 0,
  };
}

describe('filterSamplesBySearch', () => {
  const batchA = tag('batch-a', 'January Run', 'batch');
  const batchB = tag('batch-b', 'February Run', 'batch');
  const standardTag = tag('tag-1', 'January Run', 'standard');
  const samples = [
    sample('s1', 'Sample-Alpha', 'batch-a'),
    sample('s2', 'Sample-Beta', 'batch-a'),
    sample('s3', 'Sample-Gamma', 'batch-b'),
    sample('s4', 'Unbatched-One'),
  ];
  const tags = [batchA, batchB, standardTag];

  it('returns all samples when query is empty or whitespace', () => {
    expect(filterSamplesBySearch(samples, tags, '')).toEqual(samples);
    expect(filterSamplesBySearch(samples, tags, '   ')).toEqual(samples);
  });

  it('matches sample name substring case-insensitively', () => {
    expect(filterSamplesBySearch(samples, tags, 'alpha')).toEqual([samples[0]]);
    expect(filterSamplesBySearch(samples, tags, 'SAMPLE-BETA')).toEqual([samples[1]]);
  });

  it('returns all samples in a batch when batch name matches', () => {
    expect(filterSamplesBySearch(samples, tags, 'january')).toEqual([samples[0], samples[1]]);
  });

  it('includes samples in a matching batch even when their names do not match', () => {
    const result = filterSamplesBySearch(samples, tags, 'february');
    expect(result).toEqual([samples[2]]);
    expect(result.map((s) => s.Name)).toEqual(['Sample-Gamma']);
  });

  it('matches batch names case-insensitively', () => {
    expect(filterSamplesBySearch(samples, tags, 'FEBRUARY RUN')).toEqual([samples[2]]);
  });

  it('only matches unbatched samples on their own name', () => {
    expect(filterSamplesBySearch(samples, tags, 'unbatched')).toEqual([samples[3]]);
    expect(filterSamplesBySearch(samples, tags, 'january')).not.toContainEqual(samples[3]);
  });

  it('does not treat standard tag names as batch matches', () => {
    const onlyStandard = filterSamplesBySearch([sample('s5', 'Other')], [standardTag], 'january run');
    expect(onlyStandard).toEqual([]);
  });

  it('returns union of sample-name and batch-name matches', () => {
    const result = filterSamplesBySearch(samples, tags, 'gamma');
    expect(result).toEqual([samples[2]]);
  });

  it('returns empty when nothing matches', () => {
    expect(filterSamplesBySearch(samples, tags, 'no-match-here')).toEqual([]);
  });
});
