/**
 * Lab-level key output definitions for one workflow.
 *
 * One DynamoDB item is stored per laboratory + workflow. LaboratoryId is the
 * partition key and WorkflowId is the sort key. The definition is reused on
 * every subsequent run of that workflow in the lab: users tick files on a
 * completed run, the platform infers a glob, and later runs pin the matching
 * files at the top of File Manager.
 *
 * {
 *   LaboratoryId: <string>,
 *   WorkflowId: <string>,
 *   WorkflowName?: <string>,
 *   Platform?: <string>,
 *   SourceRunId?: <string>,
 *   KeyOutputs: [{ KeyOutputId, Label, Pattern, ExamplePath? }],
 *   CreatedAt?, CreatedBy?, ModifiedAt?, ModifiedBy?
 * }
 */
import { BaseAttributes } from '../base-entity';

/** Cap on declared roles per workflow. Enforced on write, not shown in the UI. */
export const WORKFLOW_KEY_OUTPUTS_LIMIT = 50;

export const WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH = 80;

export const WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH = 1024;

/**
 * One role in the key-outputs definition. `Pattern` is a path glob relative to
 * the run's File Manager root (`*` matches within a single path segment).
 */
export interface WorkflowKeyOutput {
  KeyOutputId: string;
  Label: string;
  Pattern: string;
  /** Relative path of the file the user ticked when this role was inferred. */
  ExamplePath?: string;
}

/**
 * Where to copy this workflow's key outputs after a run completes successfully.
 * One destination for now: an external `s3://bucket/prefix` the lab manager sets.
 */
export interface WorkflowKeyOutputDelivery {
  Enabled: boolean;
  DestinationUri?: string;
}

export interface WorkflowKeyOutputs extends BaseAttributes {
  LaboratoryId: string;
  WorkflowId: string;
  WorkflowName?: string;
  Platform?: string;
  /** Last completed run the lab used to pick files for this definition. */
  SourceRunId?: string;
  KeyOutputs: WorkflowKeyOutput[];
  Delivery?: WorkflowKeyOutputDelivery;
}

export interface ListWorkflowKeyOutputsResponse {
  LaboratoryId: string;
  WorkflowId: string;
  WorkflowName?: string;
  Platform?: string;
  SourceRunId?: string;
  KeyOutputs: WorkflowKeyOutput[];
  Delivery?: WorkflowKeyOutputDelivery;
  CreatedAt?: string;
  ModifiedAt?: string;
}

/** A role returned by preview, including how many files on this run match. */
export interface PreviewWorkflowKeyOutput extends WorkflowKeyOutput {
  MatchCount: number;
}

export interface PreviewWorkflowKeyOutputsResponse {
  KeyOutputs: PreviewWorkflowKeyOutput[];
}

/** One file on a run that matches a declared key-output pattern. */
export interface RunWorkflowKeyOutputMatch {
  Key: string;
  RelativePath: string;
  Size: number;
}

/**
 * A declared role scored against a specific run, including the matching files
 * so File Manager can pin them without a second listing.
 */
export interface RunWorkflowKeyOutput extends WorkflowKeyOutput {
  MatchCount: number;
  MatchSizeBytes: number;
  Matches: RunWorkflowKeyOutputMatch[];
}

/** One representative file for an inferred role, used on the declaring screen. */
export interface RunWorkflowKeyOutputGroup {
  Pattern: string;
  Label: string;
  ExamplePath: string;
  Directory: string;
  Size: number;
  MatchCount: number;
}

export interface RunWorkflowKeyOutputsResponse {
  LaboratoryId: string;
  RunId: string;
  WorkflowId: string;
  S3Bucket: string;
  S3Prefix: string;
  TotalFileCount: number;
  MatchedFileCount: number;
  MatchedSizeBytes: number;
  KeyOutputs: RunWorkflowKeyOutput[];
  Groups: RunWorkflowKeyOutputGroup[];
}
