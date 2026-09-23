import { prependAnalysisEntry } from './analysis-history';
import {
  AnalysisHistoryEntry,
  ANALYSIS_HISTORY_LIMIT,
} from '../schema/easy-genomics/laboratory-run';

const entry = (summary: string): AnalysisHistoryEntry => ({
  AnalysedAt: '2026-09-23T10:00:00.000Z',
  Owner: 'Lab',
  Summary: summary,
  Action: 'Fix it',
  ClassifiedBy: 'llm',
});

describe('prependAnalysisEntry', () => {
  it('treats a run with no history as an empty list', () => {
    expect(prependAnalysisEntry(undefined, entry('first'))).toEqual([entry('first')]);
  });

  it('puts the newest entry first', () => {
    const result = prependAnalysisEntry([entry('older')], entry('newer'));
    expect(result.map((e) => e.Summary)).toEqual(['newer', 'older']);
  });

  it('holds at the ceiling and drops the oldest rather than growing', () => {
    const full = Array.from({ length: ANALYSIS_HISTORY_LIMIT }, (_, i) => entry(`entry-${i}`));
    const result = prependAnalysisEntry(full, entry('newest'));
    expect(result).toHaveLength(ANALYSIS_HISTORY_LIMIT);
    expect(result[0].Summary).toBe('newest');
    expect(result.map((e) => e.Summary)).not.toContain(`entry-${ANALYSIS_HISTORY_LIMIT - 1}`);
  });

  it('does not mutate the array it was given', () => {
    const existing = [entry('older')];
    prependAnalysisEntry(existing, entry('newer'));
    expect(existing).toHaveLength(1);
  });
});
