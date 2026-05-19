/**
 * File-kind helpers for the Data Collections explorer file-type filter.
 * Classification drives the three checkbox filter rows; extension labels drive
 * the "hidden by file type" popout breakdown.
 */

export type DataCollectionFileKind = 'fastq' | 'fasta' | 'other';

export type DataCollectionFileTypeFilter = {
  fastq: boolean;
  fasta: boolean;
  other: boolean;
};

export type HiddenFileTypeBreakdownRow = {
  label: string;
  count: number;
};

const NO_EXTENSION_LABEL = '(no extension)';

/** Multi-part extensions checked before single-dot suffixes on the basename. */
const HIDDEN_MULTI_SUFFIXES = ['.fastq.gz', '.fq.gz'] as const;

/** Hidden popout list: these labels appear first, in this order; all others follow A–Z. */
const HIDDEN_BREAKDOWN_PRIORITY_LABELS = ['.fastq.gz', '.fasta', '.fa'] as const;

function hiddenBreakdownLabelSortRank(label: string): number {
  const idx = (HIDDEN_BREAKDOWN_PRIORITY_LABELS as readonly string[]).indexOf(label);
  return idx >= 0 ? idx : HIDDEN_BREAKDOWN_PRIORITY_LABELS.length;
}

function basenameFromS3Key(s3Key: string): string {
  const parts = s3Key.split('/').filter(Boolean);
  return parts[parts.length - 1] || s3Key;
}

/**
 * Coarse kind used by the FASTQ / FASTA / Other filter checkboxes.
 */
export function dataCollectionFileKind(s3Key: string): DataCollectionFileKind {
  const name = basenameFromS3Key(s3Key).toLowerCase();
  if (name.endsWith('.fastq.gz') || name.endsWith('.fq.gz') || name.endsWith('.fastq') || name.endsWith('.fq')) {
    return 'fastq';
  }
  if (name.endsWith('.fasta') || name.endsWith('.fa')) {
    return 'fasta';
  }
  return 'other';
}

export function enabledFileTypeKinds(filter: DataCollectionFileTypeFilter): Set<DataCollectionFileKind> {
  const kinds = new Set<DataCollectionFileKind>();
  if (filter.fastq) kinds.add('fastq');
  if (filter.fasta) kinds.add('fasta');
  if (filter.other) kinds.add('other');
  return kinds;
}

/** OR semantics: file is visible when its kind is among the enabled set. */
export function fileMatchesFileTypeFilter(s3Key: string, enabledKinds: Set<DataCollectionFileKind>): boolean {
  if (enabledKinds.size === 0) return false;
  return enabledKinds.has(dataCollectionFileKind(s3Key));
}

/**
 * Extension-centric label for the hidden-files popout (not the three filter bucket names).
 */
export function dataCollectionHiddenTypeLabel(s3Key: string): string {
  const name = basenameFromS3Key(s3Key).toLowerCase();
  for (const suffix of HIDDEN_MULTI_SUFFIXES) {
    if (name.endsWith(suffix)) return suffix;
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return NO_EXTENSION_LABEL;
  return name.slice(dot);
}

export function groupHiddenFilesByTypeLabel(files: readonly { Key: string }[]): HiddenFileTypeBreakdownRow[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const label = dataCollectionHiddenTypeLabel(f.Key);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      const rankDiff = hiddenBreakdownLabelSortRank(a.label) - hiddenBreakdownLabelSortRank(b.label);
      if (rankDiff !== 0) return rankDiff;
      return a.label.localeCompare(b.label);
    });
}

export function fileTypeFilterTriggerLabel(filter: DataCollectionFileTypeFilter): string {
  const enabled: string[] = [];
  if (filter.fastq) enabled.push('FASTQ');
  if (filter.fasta) enabled.push('FASTA');
  if (filter.other) enabled.push('Workflow outputs & other');
  if (enabled.length === 0) return 'No file types';
  if (enabled.length === 3) return 'All file types';
  if (enabled.length === 1) return enabled[0]!;
  if (enabled.length === 2) return enabled.join(', ');
  return 'All file types';
}
