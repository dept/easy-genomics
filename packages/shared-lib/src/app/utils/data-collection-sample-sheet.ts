import type { SampleSheetColumnDef, SampleSheetColumnRole, SampleLayout } from '../types/easy-genomics/samples';

export type SampleSheetSchemaValidationResult = { ok: true } | { ok: false; message: string };

export type SequenceSetFileRoleMap = Partial<Record<SampleSheetColumnRole, string>>;

export type SampleSheetRowValues = Record<string, string>;

export const SAMPLE_SHEET_COLUMN_ROLE_LABELS: Record<SampleSheetColumnRole, string> = {
  sample_id: 'Sample ID',
  read1: 'Read 1 (FASTQ)',
  read2: 'Read 2 (FASTQ)',
  reads: 'Reads (long-read / single file)',
  reference_fasta: 'Reference FASTA',
  reference_gtf: 'Reference GTF',
  reference_gff: 'Reference GFF',
  reference_bed: 'Reference BED',
  input_bam: 'Input BAM',
  input_cram: 'Input CRAM',
  input_vcf: 'Input VCF',
  assembly_fasta: 'Assembled genome (FASTA)',
  metadata: 'Metadata (text)',
  custom_uri: 'Custom S3 URI',
};

export const SAMPLE_SHEET_SCHEMA_PRESETS: Record<string, SampleSheetColumnDef[]> = {
  single: [
    { columnName: 'sample', role: 'sample_id', required: true },
    { columnName: 'fastq', role: 'reads', required: true },
  ],
  paired: [
    { columnName: 'sample', role: 'sample_id', required: true },
    { columnName: 'fastq_1', role: 'read1', required: true },
    { columnName: 'fastq_2', role: 'read2', required: true },
  ],
  hybrid: [
    { columnName: 'sample', role: 'sample_id', required: true },
    { columnName: 'fastq', role: 'reads', required: true },
    { columnName: 'fastq_1', role: 'read1', required: false },
    { columnName: 'fastq_2', role: 'read2', required: false },
  ],
  assembled: [
    { columnName: 'sample', role: 'sample_id', required: true },
    { columnName: 'fasta', role: 'assembly_fasta', required: true },
  ],
};

export const SAMPLE_SHEET_SCHEMA_PRESET_LABELS: Record<string, string> = {
  single: 'Single',
  paired: 'Paired',
  hybrid: 'Hybrid',
  assembled: 'Assembled',
};

function getFileNameWithoutExt(fileName: string): string {
  return fileName.replace(/\.f(ast)?q.*$/i, '').replace(/\.[^.]+$/, '');
}

function getReadDirection(fileName: string, sampleIdSplitPattern?: string | null): 'R1' | 'R2' | null {
  const nameWithoutExt = getFileNameWithoutExt(fileName);

  if (/_R1(?:_|$)/i.test(nameWithoutExt)) return 'R1';
  if (/_R2(?:_|$)/i.test(nameWithoutExt)) return 'R2';

  const pattern = sampleIdSplitPattern?.trim();
  if (!pattern) return null;

  const patternIndex = nameWithoutExt.indexOf(pattern);
  if (patternIndex === -1) return null;

  const suffixAfterPattern = nameWithoutExt.substring(patternIndex + pattern.length);
  const readNumberMatch = suffixAfterPattern.match(/^([12])(?:_|$)/);
  if (!readNumberMatch) return null;

  return readNumberMatch[1] === '1' ? 'R1' : 'R2';
}

function getSampleIdFromRFileName(fileName: string, sampleIdSplitPattern?: string | null): string | null {
  const pattern = sampleIdSplitPattern?.trim();
  if (pattern) {
    const idx = fileName.indexOf(pattern);
    return idx !== -1 ? fileName.substring(0, idx) || null : null;
  }
  return fileName.substring(0, fileName.lastIndexOf('_R')) || null;
}

function extensionMatches(key: string, extensions: string[]): boolean {
  const lower = key.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function isFastqKey(key: string): boolean {
  return extensionMatches(key, ['.fastq.gz', '.fq.gz', '.fastq', '.fq']);
}

function firstMatchingKey(keys: string[], extensions: string[]): string | undefined {
  return keys.find((k) => extensionMatches(k, extensions));
}

export function validateSampleSheetSchema(columns: SampleSheetColumnDef[]): SampleSheetSchemaValidationResult {
  if (!columns.length) {
    return { ok: false, message: 'At least one column is required.' };
  }

  const names = new Set<string>();
  let hasSampleId = false;
  for (const col of columns) {
    if (names.has(col.columnName)) {
      return { ok: false, message: `Duplicate column name: ${col.columnName}` };
    }
    names.add(col.columnName);
    if (col.role === 'sample_id') hasSampleId = true;
  }

  if (!hasSampleId) {
    return { ok: false, message: 'Schema must include a sample_id column.' };
  }

  return { ok: true };
}

export function mapSequenceSetFilesToRoles(
  layout: SampleLayout,
  keys: string[],
  bucket: string,
  sequenceSetName: string,
  sampleIdPattern?: string | null,
): { ok: true; roleMap: SequenceSetFileRoleMap; inputFileKeys: string[] } | { ok: false; message: string } {
  const sortedKeys = [...keys].sort();
  const roleMap: SequenceSetFileRoleMap = {};
  const inputFileKeys: string[] = [...sortedKeys];

  const toUri = (key: string) => `s3://${bucket}/${key}`;

  if (layout === 'long_reads') {
    const readKey =
      firstMatchingKey(sortedKeys, ['.fastq.gz', '.fq.gz', '.fastq', '.fq', '.bam', '.cram']) ?? sortedKeys[0];
    if (!readKey) return { ok: false, message: 'Sample has no files.' };
    roleMap.reads = toUri(readKey);
    roleMap.sample_id = sequenceSetName;
    return { ok: true, roleMap, inputFileKeys };
  }

  if (layout === 'single_end') {
    const fastqKeys = sortedKeys.filter(isFastqKey);
    const r1Key =
      fastqKeys.find((k) => getReadDirection(k.split('/').pop() || k, sampleIdPattern) !== 'R2') ?? fastqKeys[0];
    if (!r1Key) return { ok: false, message: 'Single-end sample requires at least one FASTQ file.' };
    roleMap.read1 = toUri(r1Key);
    roleMap.sample_id =
      getSampleIdFromRFileName(r1Key.split('/').pop() || r1Key, sampleIdPattern) ||
      getFileNameWithoutExt(r1Key.split('/').pop() || r1Key);
    return { ok: true, roleMap, inputFileKeys };
  }

  const fastqKeys = sortedKeys.filter(isFastqKey);
  let r1Key: string | undefined;
  let r2Key: string | undefined;

  for (const key of fastqKeys) {
    const base = key.split('/').pop() || key;
    const dir = getReadDirection(base, sampleIdPattern);
    if (dir === 'R1') r1Key = key;
    else if (dir === 'R2') r2Key = key;
  }

  if (!r1Key && fastqKeys.length >= 1) r1Key = fastqKeys[0];
  if (!r2Key && fastqKeys.length >= 2) r2Key = fastqKeys.find((k) => k !== r1Key);

  if (layout === 'paired_end' || layout === 'paired_end_with_extras') {
    if (!r1Key) return { ok: false, message: 'Paired-end sample requires at least one FASTQ file.' };
    if (layout === 'paired_end' && r2Key === undefined && fastqKeys.length > 1) {
      r2Key = fastqKeys.find((k) => k !== r1Key);
    }
    if (layout === 'paired_end' && !r2Key) {
      return { ok: false, message: 'Paired-end sample requires matching R1 and R2 files.' };
    }
    roleMap.read1 = toUri(r1Key);
    if (r2Key) roleMap.read2 = toUri(r2Key);
    const sampleBase = r1Key.split('/').pop() || r1Key;
    roleMap.sample_id =
      getSampleIdFromRFileName(sampleBase, sampleIdPattern) || getFileNameWithoutExt(sampleBase) || sequenceSetName;
  }

  if (layout === 'paired_end_with_extras') {
    const fastaKey = firstMatchingKey(sortedKeys, ['.fasta', '.fa', '.fna']);
    const gtfKey = firstMatchingKey(sortedKeys, ['.gtf']);
    const gffKey = firstMatchingKey(sortedKeys, ['.gff', '.gff3']);
    const bedKey = firstMatchingKey(sortedKeys, ['.bed']);
    const bamKey = firstMatchingKey(sortedKeys, ['.bam']);
    const cramKey = firstMatchingKey(sortedKeys, ['.cram']);
    const vcfKey = firstMatchingKey(sortedKeys, ['.vcf', '.vcf.gz']);

    if (fastaKey) roleMap.reference_fasta = toUri(fastaKey);
    if (gtfKey) roleMap.reference_gtf = toUri(gtfKey);
    if (gffKey) roleMap.reference_gff = toUri(gffKey);
    if (bedKey) roleMap.reference_bed = toUri(bedKey);
    if (bamKey) roleMap.input_bam = toUri(bamKey);
    if (cramKey) roleMap.input_cram = toUri(cramKey);
    if (vcfKey) roleMap.input_vcf = toUri(vcfKey);
  }

  if (!roleMap.sample_id) {
    roleMap.sample_id = sequenceSetName;
  }

  return { ok: true, roleMap, inputFileKeys };
}

export function buildSampleSheetRowFromRoleMap(
  columns: SampleSheetColumnDef[],
  roleMap: SequenceSetFileRoleMap,
): SampleSheetRowValues {
  const row: SampleSheetRowValues = {};
  for (const col of columns) {
    // A `reads` column (e.g. the `single`/`hybrid` presets' `fastq`) accepts a single-file
    // read. Fall back to read1 so single-end short-read samples, which only set read1,
    // still populate it.
    const value = col.role === 'reads' ? (roleMap.reads ?? roleMap.read1) : roleMap[col.role];
    row[col.columnName] = value ?? '';
  }
  return row;
}

export function validateSampleSheetRows(
  columns: SampleSheetColumnDef[],
  rows: SampleSheetRowValues[],
): SampleSheetSchemaValidationResult {
  const schemaCheck = validateSampleSheetSchema(columns);
  if (!schemaCheck.ok) return schemaCheck;

  for (let i = 0; i < rows.length; i++) {
    for (const col of columns) {
      if (col.required && !rows[i][col.columnName]?.trim()) {
        return { ok: false, message: `Row ${i + 1} is missing required column "${col.columnName}".` };
      }
    }
  }

  const sampleCol = columns.find((c) => c.role === 'sample_id');
  if (sampleCol) {
    const ids = rows.map((r) => r[sampleCol.columnName]).filter(Boolean);
    if (ids.length !== new Set(ids).size) {
      return { ok: false, message: 'Duplicate sample IDs in sample sheet.' };
    }
  }

  return { ok: true };
}

export function buildSampleSheetCsv(columns: SampleSheetColumnDef[], rows: SampleSheetRowValues[]): string {
  const header = columns.map((c) => c.columnName).join(',');
  const body = rows.map((row) =>
    columns
      .map((col) => {
        const val = row[col.columnName] ?? '';
        return val.includes(',') ? `"${val.replace(/"/g, '""')}"` : val;
      })
      .join(','),
  );
  return [header, ...body].join('\n');
}

export type SampleForSampleSheet = {
  SampleId: string;
  Name: string;
  Layout: SampleLayout;
  SampleIdPattern?: string;
  FileKeys: string[];
};

export function buildSampleSheetFromSamples(
  columns: SampleSheetColumnDef[],
  sequenceSets: SampleForSampleSheet[],
  bucket: string,
): { ok: true; csv: string; rows: SampleSheetRowValues[]; inputFileKeys: string[] } | { ok: false; message: string } {
  const schemaCheck = validateSampleSheetSchema(columns);
  if (!schemaCheck.ok) return schemaCheck;

  const rows: SampleSheetRowValues[] = [];
  const allInputKeys = new Set<string>();

  for (const set of sequenceSets) {
    const mapped = mapSequenceSetFilesToRoles(set.Layout, set.FileKeys, bucket, set.Name, set.SampleIdPattern);
    if (!mapped.ok) {
      return { ok: false, message: `${set.Name}: ${mapped.message}` };
    }
    for (const key of mapped.inputFileKeys) allInputKeys.add(key);
    rows.push(buildSampleSheetRowFromRoleMap(columns, mapped.roleMap));
  }

  const rowCheck = validateSampleSheetRows(columns, rows);
  if (!rowCheck.ok) return rowCheck;

  return {
    ok: true,
    csv: buildSampleSheetCsv(columns, rows),
    rows,
    inputFileKeys: [...allInputKeys],
  };
}
