export type LaboratoryDataTagKind = 'standard' | 'batch' | 'workflow';

export type WorkflowPlatform = 'AWS HealthOmics' | 'Seqera Cloud';

export type LaboratoryDataTag = {
  TagId: string;
  Name: string;
  ColorHex: string;
  /** Omitted or `standard` for legacy tag rows. */
  Kind?: LaboratoryDataTagKind;
  FileCount: number;
  /** Set on workflow-kind tags. Identifies the platform that ran the workflow. */
  Platform?: WorkflowPlatform;
  /** Set on workflow-kind tags. HealthOmics workflowId or Seqera pipelineId. */
  WorkflowExternalId?: string;
  /** Set on workflow-kind tags. Empty string represents the default version. */
  WorkflowVersionName?: string;
  CreatedAt?: string;
  CreatedBy?: string;
  ModifiedAt?: string;
  ModifiedBy?: string;
};

export type ListLaboratoryDataTagsResponse = {
  Tags: LaboratoryDataTag[];
};

export type FileTagAssignment = {
  Key: string;
  /** Standard (non-batch, non-workflow) tags only. */
  TagIds: string[];
  /** At most one batch tag id if the file is assigned to a batch. */
  BatchTagId?: string;
  /** Workflow tag ids that have been associated with this file via run launches. */
  WorkflowTagIds: string[];
  /**
   * Per-laboratory-run usage history for this file, sorted newest first by `RunCreatedAt`.
   * Each entry records that the file appeared in a run's `InputFileKeys` at run creation time,
   * regardless of whether the run had a `WorkflowExternalId` (so non-workflow-tagged runs are
   * still represented). Empty / omitted when the file has never been used in a run.
   */
  LaboratoryRunUsages?: LaboratoryRunUsageSummary[];
};

export type LaboratoryRunUsageSummary = {
  RunId: string;
  RunName: string;
  /** Optional: omitted if the run was created without a WorkflowName. */
  WorkflowName?: string;
  /** ISO timestamp of the laboratory run's `CreatedAt`. */
  RunCreatedAt: string;
  /** Total number of input files recorded for this run at creation time. */
  InputFileCount: number;
  /** Full list of S3 object keys (lab-scoped) for the run, used by the tooltip's "select samples" action. */
  InputFileKeys: string[];
};

export type ListFileTagsResponse = {
  Files: FileTagAssignment[];
};

export type S3TaggedObjectRef = {
  Bucket: string;
  Key: string;
};

export type ListFilesByTagResponse = {
  Files: S3TaggedObjectRef[];
  NextCursor?: string;
};
