import type { SampleGroupingStatus, SampleLayout } from '../types/easy-genomics/samples';

export type RegexGroupingFileRole = 'read1' | 'read2' | 'reads' | 'reference_fasta' | 'extra';

export type ProposedSampleFile = {
  fileName: string;
  role: RegexGroupingFileRole;
};

export type ProposedSample = {
  /** Unique per proposal (`folder + sampleId`); use it for list keys and exclusion sets, never as a name. */
  groupKey: string;
  sampleId: string;
  /** Directory part of the files' keys, ending in `/`; `''` for bare file names. */
  folder: string;
  files: ProposedSampleFile[];
  status: SampleGroupingStatus;
  layout: SampleLayout;
};

export type RegexGroupingPreset = {
  label: string;
  pattern: string;
};

export const REGEX_GROUPING_PRESETS = {
  any_separator_r1_r2: {
    label: 'R1 and R2 (any separator)',
    pattern: '(?<sample>.+?)[._-](?<read>R[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?$',
  },
  underscore_r1_r2: {
    label: '_R1 and _R2',
    pattern: '(?<sample>.+?)_(?<read>R[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?$',
  },
  dash_r1_r2: {
    label: '-R1 and -R2',
    pattern: '(?<sample>.+?)-(?<read>R[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?$',
  },
  underscore_1_2: {
    label: '_1 and _2',
    pattern: '(?<sample>.+?)_(?<read>[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?$',
  },
  dash_1_2: {
    label: '-1 and -2',
    pattern: '(?<sample>.+?)-(?<read>[12])(?:_\\d*)?\\.(?:fastq|fq)(?:\\.gz)?$',
  },
  fasta_one_per_file: {
    label: 'One sample per FASTA file',
    pattern: '(?<sample>.+?)\\.(?:fasta|fa|fna)(?:\\.gz)?$',
  },
} as const satisfies Record<string, RegexGroupingPreset>;

export type RegexGroupingPresetKey = keyof typeof REGEX_GROUPING_PRESETS;

export const DEFAULT_REGEX_GROUPING_PRESET_KEY: RegexGroupingPresetKey = 'any_separator_r1_r2';
export const FASTA_REGEX_GROUPING_PRESET_KEY: RegexGroupingPresetKey = 'fasta_one_per_file';

const FASTA_EXTENSION = /\.(?:fasta|fa|fna)(?:\.gz)?$/i;

export function isFasta(name: string): boolean {
  return FASTA_EXTENSION.test(name);
}

export function isFastq(name: string): boolean {
  return /\.(?:fastq|fq)(?:\.gz)?$/i.test(name);
}

/**
 * FASTA files and no FASTQ, so each FASTA is its own sample and grouping needs no regex.
 * Other files (indexes, checksums, BAM) don't decide it.
 */
export function hasFastaButNoFastq(fileNames: string[]): boolean {
  return fileNames.some(isFasta) && !fileNames.some(isFastq);
}

/**
 * FASTA files that a listing with FASTQ left out of every sample: one FASTA for the whole run, which the
 * user passes to the workflow as a parameter. A listing without FASTQ has none, since there each FASTA is a sample.
 */
export function findSharedFasta(fileNames: string[], unmatched: string[]): string[] {
  return fileNames.some(isFastq) ? unmatched.filter(isFasta) : [];
}

function isAssembled(files: ProposedSampleFile[]): boolean {
  const hasReads = files.some((f) => f.role === 'read1' || f.role === 'read2' || f.role === 'reads');
  return !hasReads && files.some((f) => f.role === 'reference_fasta');
}

function inferLayout(files: ProposedSampleFile[]): SampleLayout {
  const hasR2 = files.some((f) => f.role === 'read2');
  const hasRef = files.some((f) => f.role === 'reference_fasta');
  const hasLongRead = files.some((f) => f.role === 'reads' && !files.some((x) => x.role === 'read1'));
  if (hasRef && hasR2) return 'paired_end_with_extras';
  if (hasLongRead) return 'long_reads';
  if (hasR2) return 'paired_end';
  if (isAssembled(files)) return 'assembled';
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
  if (isAssembled(files)) return 'assembled';
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

type SampleFileGroup = { sampleId: string; folder: string; files: ProposedSampleFile[] };

function hasReadPair(files: ProposedSampleFile[]): boolean {
  return files.some((f) => f.role === 'read1') && files.some((f) => f.role === 'read2');
}

/**
 * Labs name a pair's own FASTA after the sample (`A.fasta` beside `A_R1`, `A_R2`), which no read preset matches.
 * Only a pair takes it: single-end and long-read sheet rows have no FASTA column, so the file would be hidden there.
 */
function attachSameNameFastaToPairs(groups: Map<string, SampleFileGroup>, unmatched: string[]): string[] {
  const stillUnmatched: string[] = [];
  for (const fileName of unmatched) {
    // A group key is `folder + sampleId`, so the key minus the extension finds the sample in the same folder and case.
    const group = isFasta(fileName) ? groups.get(fileName.replace(FASTA_EXTENSION, '')) : undefined;
    if (group && hasReadPair(group.files)) {
      group.files.push({ fileName, role: 'reference_fasta' });
    } else {
      stillUnmatched.push(fileName);
    }
  }
  return stillUnmatched;
}

export function groupFilenamesByRegex(
  fileNames: string[],
  regexPattern: string,
): { sets: ProposedSample[]; unmatched: string[] } {
  let regex: RegExp;
  try {
    // Case-insensitive to match data-collection-sample-sheet's read-direction and extension checks.
    regex = new RegExp(regexPattern, 'i');
  } catch {
    return { sets: [], unmatched: [...fileNames] };
  }

  const groups = new Map<string, SampleFileGroup>();
  const unmatched: string[] = [];

  for (const fileName of fileNames) {
    const base = fileName.split('/').pop() || fileName;
    const match = regex.exec(base);
    if (!match?.groups?.sample) {
      unmatched.push(fileName);
      continue;
    }
    const sampleId = match.groups.sample;
    // S3 keys are unique only within a folder, so one sample ID can recur across runs; the folder keeps them apart.
    const folder = fileName.slice(0, fileName.length - base.length);
    const groupKey = `${folder}${sampleId}`;
    const role = classifyFileRole(base, match.groups as Record<string, string | undefined>);
    const group = groups.get(groupKey) ?? { sampleId, folder, files: [] };
    group.files.push({ fileName, role });
    groups.set(groupKey, group);
  }

  const stillUnmatched = attachSameNameFastaToPairs(groups, unmatched);

  const sets: ProposedSample[] = [];
  for (const [groupKey, { sampleId, folder, files }] of groups) {
    sets.push({
      groupKey,
      sampleId,
      folder,
      files,
      status: inferStatus(files),
      layout: inferLayout(files),
    });
  }

  sets.sort((a, b) => a.sampleId.localeCompare(b.sampleId) || a.folder.localeCompare(b.folder));
  return { sets, unmatched: stillUnmatched };
}

/** Display form of a folder: drops the leading `<OrganizationId>/<LaboratoryId>/` that every lab key starts with. */
export function folderBelowLabRoot(folder: string): string {
  return folder.split('/').slice(2).join('/');
}

export type DuplicateSampleName = {
  sampleId: string;
  folders: string[];
};

/** Sample IDs proposed from more than one folder, so the review step can flag them before import. Case-insensitive, like the grouping regex. */
export function findDuplicateSampleNames(sets: ProposedSample[]): DuplicateSampleName[] {
  const byLowercaseName = new Map<string, DuplicateSampleName>();
  for (const set of sets) {
    const key = set.sampleId.toLowerCase();
    const entry = byLowercaseName.get(key) ?? { sampleId: set.sampleId, folders: [] };
    entry.folders.push(set.folder);
    byLowercaseName.set(key, entry);
  }
  return [...byLowercaseName.values()]
    .filter((entry) => entry.folders.length > 1)
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));
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
