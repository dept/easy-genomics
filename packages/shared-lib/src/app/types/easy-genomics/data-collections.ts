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
