import type { SampleGroupingStatus, SampleLayout } from '../types/easy-genomics/samples';

export type RegexGroupingFileRole = 'read1' | 'read2' | 'reads' | 'reference_fasta' | 'extra';

export type ProposedSampleFile = {
  fileName: string;
  role: RegexGroupingFileRole;
};

export type ProposedSample = {
  sampleId: string;
  files: ProposedSampleFile[];
  status: SampleGroupingStatus;
  layout: SampleLayout;
};

export type RegexGroupingPreset = {
  label: string;
  pattern: string;
};

export const REGEX_GROUPING_PRESETS = {
  underscore_r1_r2: {
    label: '_R1 and _R2',
    pattern: '(?<sample>.+?)_(?<read>R[12])(?:_001)?\\.fastq\\.gz',
  },
  dash_r1_r2: {
    label: '-R1 and -R2',
    pattern: '(?<sample>.+?)-(?<read>R[12])(?:_001)?\\.fastq\\.gz',
  },
  underscore_1_2: {
    label: '_1 and _2',
    pattern: '(?<sample>.+?)_(?<read>[12])(?:_001)?\\.fastq\\.gz',
  },
  dash_1_2: {
    label: '-1 and -2',
    pattern: '(?<sample>.+?)-(?<read>[12])(?:_001)?\\.fastq\\.gz',
  },
} as const satisfies Record<string, RegexGroupingPreset>;

export type RegexGroupingPresetKey = keyof typeof REGEX_GROUPING_PRESETS;

function isFasta(name: string): boolean {
  return /\.(fasta|fa|fna)(?:\\.gz)?$/i.test(name);
}

function inferLayout(files: ProposedSampleFile[]): SampleLayout {
  const hasR2 = files.some((f) => f.role === 'read2');
  const hasRef = files.some((f) => f.role === 'reference_fasta');
  const hasLongRead = files.some((f) => f.role === 'reads' && !files.some((x) => x.role === 'read1'));
  if (hasRef && hasR2) return 'paired_end_with_extras';
  if (hasLongRead) return 'long_reads';
  if (hasR2) return 'paired_end';
  return 'single_end';
}

function inferStatus(files: ProposedSampleFile[]): SampleGroupingStatus {
  if (!files.length) return 'unmatched';
  const hasR1 = files.some((f) => f.role === 'read1');
  const hasR2 = files.some((f) => f.role === 'read2');
  const hasReads = files.some((f) => f.role === 'reads');
  if (hasR1 && hasR2) return 'paired';
  if (hasReads) return 'long_reads';
  if (hasR1) return 'single_end';
  return 'needs_review';
}

function classifyFileRole(fileName: string, groups: Record<string, string | undefined>): RegexGroupingFileRole {
  if (isFasta(fileName)) return 'reference_fasta';
  const read = groups.read?.toUpperCase();
  if (read === 'R1' || read === '1') return 'read1';
  if (read === 'R2' || read === '2') return 'read2';
  if (/\.fastq|\.fq/i.test(fileName)) return 'reads';
  return 'extra';
}

export function groupFilenamesByRegex(
  fileNames: string[],
  regexPattern: string,
): { sets: ProposedSample[]; unmatched: string[] } {
  let regex: RegExp;
  try {
    regex = new RegExp(regexPattern);
  } catch {
    return { sets: [], unmatched: [...fileNames] };
  }

  const bySample = new Map<string, ProposedSampleFile[]>();
  const unmatched: string[] = [];

  for (const fileName of fileNames) {
    const base = fileName.split('/').pop() || fileName;
    const match = regex.exec(base);
    if (!match?.groups?.sample) {
      unmatched.push(fileName);
      continue;
    }
    const sampleId = match.groups.sample;
    const role = classifyFileRole(base, match.groups as Record<string, string | undefined>);
    const existing = bySample.get(sampleId) || [];
    existing.push({ fileName, role });
    bySample.set(sampleId, existing);
  }

  const sets: ProposedSample[] = [];
  for (const [sampleId, files] of bySample) {
    sets.push({
      sampleId,
      files,
      status: inferStatus(files),
      layout: inferLayout(files),
    });
  }

  sets.sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  return { sets, unmatched };
}

export function buildContentsSummary(files: ProposedSampleFile[]): string {
  const count = files.length;
  const hasR1 = files.some((f) => f.role === 'read1');
  const hasR2 = files.some((f) => f.role === 'read2');
  const hasRef = files.some((f) => f.role === 'reference_fasta');
  if (hasR1 && hasR2 && hasRef) return `${count} files · R1 + R2 + ref`;
  if (hasR1 && hasR2) return `${count} files · R1 + R2`;
  if (hasR1) return `${count} file${count === 1 ? '' : 's'} · R1 (single-end)`;
  if (files.some((f) => f.role === 'reads')) return `${count} file${count === 1 ? '' : 's'} · long-read`;
  return `${count} file${count === 1 ? '' : 's'}`;
}
