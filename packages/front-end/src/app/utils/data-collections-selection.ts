export type ExplorerSelectionItem = { type: 'file'; key: string } | { type: 'sample'; sampleId: string };

export type ExplorerSelection = ExplorerSelectionItem[];

export const SAMPLE_LAYOUT_LABELS: Record<string, string> = {
  paired_end: 'Paired-end (R1+R2)',
  single_end: 'Single-end (R1 only)',
  long_reads: 'Long-reads (reads)',
  paired_end_with_extras: 'Paired-end + extras',
};

/** @deprecated Use SAMPLE_LAYOUT_LABELS */
export const SEQUENCE_SET_LAYOUT_LABELS = SAMPLE_LAYOUT_LABELS;

export function selectionKey(item: ExplorerSelectionItem): string {
  return item.type === 'file' ? `file:${item.key}` : `sample:${item.sampleId}`;
}

export function parseSelectionKey(key: string): ExplorerSelectionItem | null {
  if (key.startsWith('file:')) return { type: 'file', key: key.slice(5) };
  if (key.startsWith('sample:')) return { type: 'sample', sampleId: key.slice('sample:'.length) };
  // Legacy persisted keys
  if (key.startsWith('sequenceSet:')) return { type: 'sample', sampleId: key.slice('sequenceSet:'.length) };
  // Legacy: bare S3 key treated as file
  if (key.includes('/')) return { type: 'file', key };
  return null;
}

export function selectionHasOnlyFiles(selection: ExplorerSelection): boolean {
  return selection.length > 0 && selection.every((s) => s.type === 'file');
}

export function selectionHasOnlySamples(selection: ExplorerSelection): boolean {
  return selection.length > 0 && selection.every((s) => s.type === 'sample');
}

export function selectedFileKeys(selection: ExplorerSelection): string[] {
  return selection.filter((s): s is { type: 'file'; key: string } => s.type === 'file').map((s) => s.key);
}

export function selectedSampleIds(selection: ExplorerSelection): string[] {
  return selection.filter((s): s is { type: 'sample'; sampleId: string } => s.type === 'sample').map((s) => s.sampleId);
}

export function toggleSelectionItem(selection: ExplorerSelection, item: ExplorerSelectionItem): ExplorerSelection {
  const key = selectionKey(item);
  const keys = new Set(selection.map(selectionKey));
  if (keys.has(key)) {
    return selection.filter((s) => selectionKey(s) !== key);
  }
  return [...selection, item];
}

export function selectionFromLegacyKeys(keys: string[]): ExplorerSelection {
  return keys.map((k) => parseSelectionKey(k)).filter((x): x is ExplorerSelectionItem => x != null);
}

export function selectionToLegacyKeys(selection: ExplorerSelection): string[] {
  return selection.map(selectionKey);
}
