/**
 * Client-side alerts for FASTQ files selected on the run Upload Data step.
 * Paired-end intent = at least one sample has both R1 and R2.
 */

export type UploadPairPresence = {
  sampleId: string;
  hasR1: boolean;
  hasR2: boolean;
};

export type UploadFileAlertCode = 'missing_r1' | 'missing_r2' | 'mixed_single_and_paired' | 'odd_file_count';

export type UploadFileAlertAnalysis = {
  /** Sample IDs that should show a row-level Alert badge (on each of their file rows). */
  flaggedSampleIds: Set<string>;
  /** Number of file rows that should show an Alert badge. */
  flaggedFileCount: number;
  codes: UploadFileAlertCode[];
  /** Combined banner body after the bold lead-in (empty if no alerts). */
  bannerDetail: string | null;
};

function countFiles(pairs: UploadPairPresence[]): number {
  return pairs.reduce((n, p) => n + (p.hasR1 ? 1 : 0) + (p.hasR2 ? 1 : 0), 0);
}

/**
 * Analyze selected file pairs for upload warnings.
 * Pure single-end sets (no complete pair) are allowed; odd count is only flagged when paired-end intent exists.
 */
export function analyzeUploadFileAlerts(pairs: UploadPairPresence[]): UploadFileAlertAnalysis {
  const empty: UploadFileAlertAnalysis = {
    flaggedSampleIds: new Set(),
    flaggedFileCount: 0,
    codes: [],
    bannerDetail: null,
  };

  if (!pairs.length) return empty;

  const hasCompletePair = pairs.some((p) => p.hasR1 && p.hasR2);
  const incompletePairs = pairs.filter((p) => !p.hasR1 || !p.hasR2);
  const hasIncomplete = incompletePairs.length > 0;
  const totalFiles = countFiles(pairs);
  const codes: UploadFileAlertCode[] = [];
  const flaggedSampleIds = new Set<string>();

  // Incomplete mates are only a problem when the set looks paired-end (or R2 exists without R1).
  const r2WithoutR1 = incompletePairs.filter((p) => p.hasR2 && !p.hasR1);
  const r1WithoutR2 = incompletePairs.filter((p) => p.hasR1 && !p.hasR2);

  if (r2WithoutR1.length > 0) {
    codes.push('missing_r1');
    for (const p of r2WithoutR1) flaggedSampleIds.add(p.sampleId);
  }

  if (hasCompletePair && r1WithoutR2.length > 0) {
    codes.push('missing_r2');
    for (const p of r1WithoutR2) flaggedSampleIds.add(p.sampleId);
  }

  if (hasCompletePair && hasIncomplete) {
    codes.push('mixed_single_and_paired');
    for (const p of incompletePairs) flaggedSampleIds.add(p.sampleId);
  }

  if (hasCompletePair && totalFiles % 2 === 1) {
    codes.push('odd_file_count');
    // Odd count is a set-level issue; incomplete samples already flagged. If somehow every sample
    // is complete but count is odd, leave sample flags as-is (shouldn't happen for R1/R2 pairs).
  }

  const uniqueCodes = [...new Set(codes)];
  const flaggedFileCount = pairs
    .filter((p) => flaggedSampleIds.has(p.sampleId))
    .reduce((n, p) => n + (p.hasR1 ? 1 : 0) + (p.hasR2 ? 1 : 0), 0);

  return {
    flaggedSampleIds,
    flaggedFileCount,
    codes: uniqueCodes,
    bannerDetail: buildBannerDetail(uniqueCodes, totalFiles),
  };
}

export function buildBannerDetail(codes: UploadFileAlertCode[], totalFiles: number): string | null {
  if (!codes.length) return null;

  const parts: string[] = [];

  if (codes.includes('odd_file_count')) {
    parts.push(`The number of files is odd (${totalFiles}) — paired-end data expects an even number of files`);
  }

  if (codes.includes('missing_r1') || codes.includes('missing_r2')) {
    parts.push('one or more samples are missing an R1 or R2 file');
  } else if (codes.includes('mixed_single_and_paired')) {
    parts.push('there is a mix of single files and paired files');
  }

  if (!parts.length) return null;

  if (parts.length === 1) {
    const sentence = parts[0];
    return sentence.endsWith('.') ? sentence : `${sentence}.`;
  }

  // "A, and B."
  const [first, ...rest] = parts;
  return `${first}, and ${rest.join(', ')}.`;
}

export const UPLOAD_ALERT_BANNER_LEAD = 'Some files need checking before you can upload.';
