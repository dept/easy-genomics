/**
 * The following LaboratoryRun model represents the data stored in the
 * laboratory-run-table to support tracking Seqera NextFlow / AWS HealthOmics
 * runs for each Laboratory.
 *
 * The LaboratoryId serves as the DynamoDB HashKey, and the RunId
 * serves as the DynamoDB SortKey - and cannot be modified after creation.
 *
 * {
 *   LaboratoryId: <string>,
 *   RunId: <string>,
 *   UserId: <string>,
 *   OrganizationId: <string>,
 *   RunName: <string>,
 *   Platform: <string>,
 *   PlatformApiBaseUrl?: <string>,
 *   Status: <string>,
 *   Owner: <string>, // User Email for display purposes
 *   WorkflowName?: <string>, // Seqera Pipeline Name or AWS HealthOmics Workflow Name
 *   WorkflowVersionName?: <string>, // AWS HealthOmics workflow version name when applicable
 *   ExternalRunId?: <string>,
 *   InputS3Url?: <string>,
 *   OutputS3Url?: <string>,
 *   SampleSheetS3Url?: <string>,
 *   Settings?: <string>, // JSON string
 *   CreatedAt?: <string>,
 *   CreatedBy?: <string>,
 *   ModifiedAt?: <string>,
 *   ModifiedBy?: <string>,
 * }
 */
import { BaseAttributes, RunType } from "../base-entity";

export interface LaboratoryRun extends BaseAttributes {
  LaboratoryId: string; // DynamoDB Partition Key (String)
  RunId: string; // DynamoDB Sort Key (String) & Global Secondary Index (String)
  UserId: string; // Global Secondary Index (String)
  OrganizationId: string; // Global Secondary Index (String)
  RunName: string;
  Platform: RunType,
  PlatformApiBaseUrl?: string, // Used if Laboratory uses alternative Seqera Platform API Base URL
  Status: string;
  Owner: string; // User Email for display purposes
  WorkflowName?: string; // Seqera Pipeline Name or AWS HealthOmics Workflow Name
  WorkflowVersionName?: string;
  /**
   * Platform-side workflow identifier (HealthOmics workflowId or Seqera pipelineId).
   * Used by the data tagging system to associate input files with a stable workflow identity.
   */
  WorkflowExternalId?: string;
  /**
   * S3 object keys (within the laboratory bucket) that were used as inputs for this run.
   * Used by the data tagging system to record file -> workflow associations and (in a future
   * ticket) to render per-file run history.
   */
  InputFileKeys?: string[];
  ExternalRunId?: string;
  InputS3Url?: string;
  OutputS3Url?: string;
  SampleSheetS3Url?: string;
  Settings?: string; // JSON string

  /**
   * ISO timestamp indicating when the run first reached a terminal state.
   * Used as the anchor for retention/TTL recomputation.
   */
  TerminalAt?: string;

  /**
   * DynamoDB TTL epoch timestamp (in seconds).
   * When present, DynamoDB will remove the item after this timestamp.
   */
  ExpiresAt?: number;

  /**
   * Actual execution duration reported by the underlying platform, in seconds.
   *
   * - Seqera Cloud: derived from `workflow.duration` (milliseconds from the Tower API).
   * - AWS HealthOmics: derived from `stopTime - startTime` from the Omics GetRun response.
   *
   * Populated by the status-check processor once the platform has terminal timing data.
   * Used by the dashboard to compute accurate averages without relying on `ModifiedAt`,
   * which is bumped by unrelated background updates (retention, tags, etc.).
   */
  RunDurationSeconds?: number;

  /**
   * Top-level machine-code failure reason reported by the platform when the run reached
   * FAILED state. Sourced from HealthOmics `failureReason` or Seqera `workflow.errorMessage`.
   * The human-readable detail lives in `FailureStatusMessage` / `FailureErrorReport`.
   * Absent on runs that failed before this field was introduced.
   */
  FailureReason?: string;

  /**
   * HealthOmics human-readable `statusMessage` (often carries the failing task name and a
   * CloudWatch log link). Kept separate from the machine-code `FailureReason` so the
   * classifier receives both signals.
   */
  FailureStatusMessage?: string;

  /**
   * Seqera `workflow.errorReport` — the richer Nextflow stack-trace / error detail,
   * distinct from the one-line `workflow.errorMessage` stored in `FailureReason`.
   */
  FailureErrorReport?: string;

  /**
   * Party responsible for resolving the failure. Populated asynchronously by the
   * failure-classification pipeline after a FAILED transition.
   * - `Lab` — user-provided inputs or data (sample sheet, S3 paths, file size)
   * - `Bioinformatician` — workflow definition, container image, or resource config
   * - `AWS` — transient AWS-side issue; retry recommended
   * - `Ambiguous` — could not be confidently attributed; needs CloudWatch investigation
   */
  FailureOwner?: 'Bioinformatician' | 'Lab' | 'AWS' | 'Ambiguous';

  /** One-line human-readable summary of the failure suitable for inline display. */
  FailureSummary?: string;

  /** Imperative-voice suggested next step (e.g. "Increase memory allocation"). */
  FailureAction?: string;

  /**
   * Provenance of the classification: `lookup` = deterministic table hit (high confidence),
   * `llm` = produced by the configured LLM provider (display "AI-assisted" disclaimer).
   */
  FailureClassifiedBy?: 'lookup' | 'llm';

  /**
   * Approximate task completion percentage derived from HealthOmics ListRunTasks
   * (completed / total known tasks). Denominator grows as the workflow DAG expands.
   */
  ProgressPercent?: number;

  /** Total known tasks at last status check. */
  TasksTotal?: number;

  /** Tasks in COMPLETED status at last status check. */
  TasksCompleted?: number;

  /** Tasks in RUNNING/STARTING status at last status check. */
  TasksRunning?: number;

  /** Tasks in FAILED status at last status check. */
  TasksFailed?: number;
}
