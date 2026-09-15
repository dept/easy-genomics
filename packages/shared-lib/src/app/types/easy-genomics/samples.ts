import type { LaboratoryRunUsageSummary } from './data-collections';

export type SampleLayout = 'paired_end' | 'single_end' | 'long_reads' | 'paired_end_with_extras';

export type SampleImportSource = {
  type: 's3_import' | 'manual';
  label: string;
  importedAt: string;
};

export type SampleGroupingStatus = 'paired' | 'single_end' | 'long_reads' | 'needs_review' | 'unmatched';

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
  | 'assembly_fasta'
  | 'metadata'
  | 'custom_uri';

export type SampleSheetColumnDef = {
  columnName: string;
  role: SampleSheetColumnRole;
  required: boolean;
};

export type LaboratorySample = {
  SampleId: string;
  Name: string;
  Layout: SampleLayout;
  FilenameRegex?: string;
  SampleIdPattern?: string;
  FileCount: number;
  /** Standard (non-workflow, non-permanent, non-batch) tags on this sample. */
  TagIds?: string[];
  /** At most one batch tag per sample. */
  BatchTagId?: string;
  WorkflowTagIds?: string[];
  IsPermanent?: boolean;
  ImportSource?: SampleImportSource;
  /** Human-readable summary for list UI, e.g. "2 files · R1 + R2". */
  ContentsSummary?: string;
  LaboratoryRunUsages?: LaboratoryRunUsageSummary[];
  CreatedAt?: string;
  CreatedBy?: string;
  ModifiedAt?: string;
  ModifiedBy?: string;
};

export type SampleTagAssignment = {
  SampleId: string;
  TagIds: string[];
  BatchTagId?: string;
  WorkflowTagIds: string[];
  IsPermanent?: boolean;
  LaboratoryRunUsages?: LaboratoryRunUsageSummary[];
};

export type ListSampleTagsResponse = {
  Samples: SampleTagAssignment[];
};

export type ListSamplesByTagResponse = {
  SampleIds: string[];
  NextCursor?: string;
};

export type ListLaboratorySamplesResponse = {
  Samples: LaboratorySample[];
};

export type LaboratorySequenceCollection = {
  SequenceCollectionId: string;
  Name: string;
  Columns: SampleSheetColumnDef[];
  SampleCount: number;
  LastSampleSheetS3Url?: string;
  CreatedAt?: string;
  CreatedBy?: string;
  ModifiedAt?: string;
  ModifiedBy?: string;
};

export type ListLaboratorySequenceCollectionsResponse = {
  SequenceCollections: LaboratorySequenceCollection[];
};

export type GenerateSequenceCollectionSampleSheetResponse = {
  SampleSheetS3Url: string;
  InputFileKeys: string[];
  CsvPreview: string;
};
