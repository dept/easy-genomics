import { AnalysisHistoryEntry, ANALYSIS_HISTORY_LIMIT } from '../schema/easy-genomics/laboratory-run';

/**
 * Add a completed analysis to a run's history, newest first, bounded.
 *
 * Returns a new array — the caller spreads the run record into a DynamoDB
 * update, and mutating the value already on that record would make the write
 * depend on evaluation order.
 */
export function prependAnalysisEntry(
  existing: AnalysisHistoryEntry[] | undefined,
  entry: AnalysisHistoryEntry,
): AnalysisHistoryEntry[] {
  return [entry, ...(existing ?? [])].slice(0, ANALYSIS_HISTORY_LIMIT);
}
