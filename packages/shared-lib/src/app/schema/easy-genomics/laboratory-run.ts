import { z } from 'zod';
import {
  BilledCostSchema,
  PreRunCostEstimateSchema,
  RunCostOutcomeSchema,
  RunInputProfileSchema,
} from './laboratory-run-cost';

const laboratoryRunCostFields = {
  /** Pre-run input features for historical cost similarity matching. */
  RunInputProfile: RunInputProfileSchema.optional(),
  /** Snapshot of the pre-run estimate band shown at Review & Launch. */
  PreRunCostEstimate: PreRunCostEstimateSchema.optional(),
  /** Platform compute/storage estimate captured at terminal state. */
  RunCostOutcome: RunCostOutcomeSchema.optional(),
  /** AWS Cost Explorer billed cost synced ~24–48h after completion. */
  BilledCost: BilledCostSchema.optional(),
};

export const LaboratoryRunSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().uuid(),
    UserId: z.string().uuid(),
    OrganizationId: z.string().uuid(),
    RunName: z.string(),
    /** Optional user-authored note for this run; set at creation time. */
    Description: z.string().max(500).optional(),
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    PlatformApiBaseUrl: z.string().optional(),
    Status: z.string(),
    Owner: z.string(),
    WorkflowName: z.string().optional(),
    WorkflowVersionName: z.string().optional(),
    /**
     * Platform-side workflow identifier (HealthOmics workflowId or Seqera pipelineId).
     * Persisted at run-creation time so the data tagging system can associate inputs
     * with a stable workflow identity.
     */
    WorkflowExternalId: z.string().optional(),
    /**
     * S3 object keys (within the laboratory bucket) that were used as inputs
     * for this run. Populated at run-creation time and consumed by the data
     * tagging system to record file -> workflow associations. Optional because
     * legacy runs and runs whose input keys could not be determined will not
     * have this field.
     */
    InputFileKeys: z.array(z.string()).optional(),
    ExternalRunId: z.string().optional(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
    /**
     * ISO timestamp indicating when the run first reached a terminal state.
     * Used as the anchor for retention/TTL recomputation.
     */
    TerminalAt: z.string().optional(),
    /**
     * DynamoDB TTL epoch timestamp (in seconds).
     * When enabled, DynamoDB will remove items after this timestamp.
     */
    ExpiresAt: z.number().optional(),
    /**
     * Actual execution duration reported by the underlying platform, in seconds.
     * Populated by the status-check processor from Seqera `workflow.duration`
     * or AWS HealthOmics `stopTime - startTime`.
     */
    RunDurationSeconds: z.number().nonnegative().optional(),
    /**
     * Top-level failure reason reported by the platform when a run reaches FAILED state.
     * Sourced from HealthOmics `failureReason` or Seqera `workflow.errorMessage`.
     * Absent on runs that failed before this field was introduced.
     */
    FailureReason: z.string().optional(),
    /**
     * HealthOmics human-readable `statusMessage` (often carries the failing task name
     * and a CloudWatch log link). Kept separate from the machine-code `FailureReason`
     * so the classifier receives both signals.
     */
    FailureStatusMessage: z.string().optional(),
    /**
     * Seqera `workflow.errorReport` — the richer Nextflow stack-trace / error detail,
     * distinct from the one-line `workflow.errorMessage` stored in `FailureReason`.
     */
    FailureErrorReport: z.string().optional(),
    /**
     * Party responsible for resolving a failure: Lab user (input/data), Bioinformatician
     * (workflow definition), AWS (transient, retry), or Ambiguous (needs investigation).
     * Populated asynchronously by the classification pipeline after a FAILED transition.
     */
    FailureOwner: z.enum(['Bioinformatician', 'Lab', 'AWS', 'Ambiguous']).optional(),
    /** One-line human summary of the failure suitable for inline display. */
    FailureSummary: z.string().optional(),
    /** Suggested next step, imperative voice (e.g. "Increase memory allocation"). */
    FailureAction: z.string().optional(),
    /**
     * Provenance of the classification: `lookup` = deterministic table hit,
     * `llm` = produced by the configured LLM provider. Used to render an
     * AI-assisted disclaimer in the UI and for ops debugging.
     */
    FailureClassifiedBy: z.enum(['lookup', 'llm']).optional(),
    /**
     * Sparse marker present only while the run is non-terminal. Backs the `PollStatus_Index`
     * GSI so the notification poller can query "every active run" in O(1) regardless of total
     * run history, instead of scanning or iterating every lab. Removed (not set false) on the
     * non-terminal -> terminal transition.
     */
    PollStatus: z.literal('ACTIVE').optional(),
    /**
     * ISO timestamp set exactly once, guarded by a conditional write
     * (`attribute_not_exists(NotifiedAt)`), the first time a terminal-state notification is
     * published for this run. Prevents a duplicate status-check message from double-emailing.
     */
    NotifiedAt: z.string().optional(),
    ...laboratoryRunCostFields,
    /**
     * Approximate task completion percentage derived from HealthOmics ListRunTasks
     * (or Seqera progress when populated). Denominator grows as the workflow DAG
     * expands, so prefer showing TasksCompleted/TasksTotal alongside this value.
     */
    ProgressPercent: z.number().min(0).max(100).optional(),
    /** Total known tasks at last status check (denominator for ProgressPercent). */
    TasksTotal: z.number().nonnegative().optional(),
    /** Tasks in COMPLETED status at last status check. */
    TasksCompleted: z.number().nonnegative().optional(),
    /** Tasks in RUNNING/STARTING status at last status check. */
    TasksRunning: z.number().nonnegative().optional(),
    /** Tasks in FAILED status at last status check. */
    TasksFailed: z.number().nonnegative().optional(),
  })
  .strict();
export type LaboratoryRun = z.infer<typeof LaboratoryRunSchema>;

export const ReadLaboratoryRunSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().uuid(),
    UserId: z.string().uuid(),
    OrganizationId: z.string().uuid(),
    RunName: z.string(),
    /** Optional user-authored note for this run; set at creation time. */
    Description: z.string().max(500).optional(),
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    PlatformApiBaseUrl: z.string().optional(), // Used if Laboratory uses alternative Seqera Platform API Base URL
    Status: z.string(),
    Owner: z.string(), // User Email for display purposes
    WorkflowName: z.string().optional(), // Seqera Pipeline Name or AWS HealthOmics Workflow Name
    WorkflowVersionName: z.string().optional(),
    WorkflowExternalId: z.string().optional(),
    InputFileKeys: z.array(z.string()).optional(),
    ExternalRunId: z.string().optional(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
    TerminalAt: z.string().optional(),
    ExpiresAt: z.number().optional(),
    RunDurationSeconds: z.number().nonnegative().optional(),
    FailureReason: z.string().optional(),
    FailureStatusMessage: z.string().optional(),
    FailureErrorReport: z.string().optional(),
    FailureOwner: z.enum(['Bioinformatician', 'Lab', 'AWS', 'Ambiguous']).optional(),
    FailureSummary: z.string().optional(),
    FailureAction: z.string().optional(),
    FailureClassifiedBy: z.enum(['lookup', 'llm']).optional(),
    ...laboratoryRunCostFields,
    ProgressPercent: z.number().min(0).max(100).optional(),
    TasksTotal: z.number().nonnegative().optional(),
    TasksCompleted: z.number().nonnegative().optional(),
    TasksRunning: z.number().nonnegative().optional(),
    TasksFailed: z.number().nonnegative().optional(),
  })
  .strict();
export type ReadLaboratoryRun = z.infer<typeof ReadLaboratoryRunSchema>;

export const AddLaboratoryRunSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().uuid(),
    RunName: z.string(),
    /** Optional user-authored note for this run; set at creation time. */
    Description: z.string().max(500).optional(),
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    PlatformApiBaseUrl: z.string().optional(),
    Status: z.string(),
    WorkflowName: z.string().optional(), // Seqera Pipeline Name or AWS HealthOmics Workflow Name
    WorkflowVersionName: z.string().optional(),
    /** HealthOmics workflowId or Seqera pipelineId; used to associate inputs with the workflow tag. */
    WorkflowExternalId: z.string().optional(),
    /** S3 object keys (within the laboratory bucket) used as inputs for this run. */
    InputFileKeys: z.array(z.string()).optional(),
    ExternalRunId: z.string().optional(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
  })
  .strict();
export type AddLaboratoryRun = z.infer<typeof AddLaboratoryRunSchema>;

export const EditLaboratoryRunSchema = z
  .object({
    Status: z.string(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
  })
  .strict();
export type EditLaboratoryRun = z.infer<typeof EditLaboratoryRunSchema>;
