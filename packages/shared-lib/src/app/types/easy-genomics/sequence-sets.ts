import type { LaboratoryRunUsageSummary } from './data-collections';

export type SequenceSetLayout = 'paired_end' | 'single_end' | 'long_reads' | 'paired_end_with_extras';

export type SequenceSetImportSource = {
  type: 's3_import' | 'manual';
  label: string;
  importedAt: string;
};

export type SequenceSetGroupingStatus = 'paired' | 'single_end' | 'long_reads' | 'needs_review' | 'unmatched';

export type SampleSheetColumnRole =
  | 'sample_id'
  | 'read1'
  | 'read2'
  | 'reads'
  | 'reference_fasta'
  | 'reference_gtf'
  | 'reference_gff'
  | 'reference_bed'
  | 'input_bam'
  | 'input_cram'
  | 'input_vcf'
  | 'metadata'
  | 'custom_uri';

export type SampleSheetColumnDef = {
  columnName: string;
  role: SampleSheetColumnRole;
  required: boolean;
};

export type LaboratorySequenceSet = {
  SequenceSetId: string;
  Name: string;
  Layout: SequenceSetLayout;
  FilenameRegex?: string;
  SampleIdPattern?: string;
  FileCount: number;
  /** Standard (non-workflow, non-permanent) tags on this sequence set. */
  TagIds?: string[];
  WorkflowTagIds?: string[];
  IsPermanent?: boolean;
  ImportSource?: SequenceSetImportSource;
  /** Human-readable summary for list UI, e.g. "2 files · R1 + R2". */
  ContentsSummary?: string;
  LaboratoryRunUsages?: LaboratoryRunUsageSummary[];
  CreatedAt?: string;
  CreatedBy?: string;
  ModifiedAt?: string;
  ModifiedBy?: string;
};

export type SequenceSetTagAssignment = {
  SequenceSetId: string;
  TagIds: string[];
  WorkflowTagIds: string[];
  IsPermanent?: boolean;
  LaboratoryRunUsages?: LaboratoryRunUsageSummary[];
};

export type ListSequenceSetTagsResponse = {
  SequenceSets: SequenceSetTagAssignment[];
};

export type ListSequenceSetsByTagResponse = {
  SequenceSetIds: string[];
  NextCursor?: string;
};

export type ListLaboratorySequenceSetsResponse = {
  SequenceSets: LaboratorySequenceSet[];
};

export type LaboratoryRunDataCollection = {
  DataCollectionId: string;
  Name: string;
  Columns: SampleSheetColumnDef[];
  SequenceSetCount: number;
  LastSampleSheetS3Url?: string;
  CreatedAt?: string;
  CreatedBy?: string;
  ModifiedAt?: string;
  ModifiedBy?: string;
};

export type ListLaboratoryRunDataCollectionsResponse = {
  DataCollections: LaboratoryRunDataCollection[];
};

export type GenerateDataCollectionSampleSheetResponse = {
  SampleSheetS3Url: string;
  InputFileKeys: string[];
  CsvPreview: string;
};
