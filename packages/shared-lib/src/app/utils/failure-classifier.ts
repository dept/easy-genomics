/**
 * Deterministic classifier for AWS HealthOmics run failures.
 *
 * Maps the documented `failureReason` codes from the HealthOmics GetRun response
 * to an owner, a one-line summary, and an actionable next step. Two codes
 * (`WORKFLOW_RUN_FAILED`, `RUN_TASK_FAILED`) are intentionally NOT in this table —
 * they are too generic to attribute deterministically and are routed to the
 * LLM classifier instead.
 *
 * Seqera Cloud has no standardized error codes — `workflow.errorMessage` is
 * free-text — so there is no Seqera lookup. Seqera failures go straight to the
 * LLM classifier.
 *
 * Source: error-handling-matrix-run-failures.csv (kept in repo root) and the
 * HealthOmics public API documentation.
 */

export type FailureOwner = 'Bioinformatician' | 'Lab' | 'AWS' | 'Ambiguous';

export interface ClassificationResult {
  owner: FailureOwner;
  summary: string;
  action: string;
}

export const HEALTHOMICS_FAILURE_LOOKUP: Record<string, ClassificationResult> = {
  ECR_PERMISSION_ERROR: {
    owner: 'Bioinformatician',
    summary: "HealthOmics can't access the container image in ECR.",
    action: 'Grant the HealthOmics service principal access to the ECR repository.',
  },
  ASSUME_ROLE_FAILED: {
    owner: 'Bioinformatician',
    summary: "HealthOmics can't assume the run role.",
    action: "Add the HealthOmics principal to the role's trust relationship.",
  },
  CANNOT_START_CONTAINER_ERROR: {
    owner: 'Bioinformatician',
    summary: 'Container image is invalid or inaccessible.',
    action: 'Verify the image URI and confirm that it is accessible to the run role.',
  },
  CANNOT_START_CONTAINER_SIZE_ERROR: {
    owner: 'Bioinformatician',
    summary: 'Container image exceeds the HealthOmics size limit (45 GiB, 95 GiB for GPU).',
    action: 'Reduce container image size or split the workflow into smaller stages.',
  },
  IMAGE_VERIFICATION_FAILURE: {
    owner: 'Bioinformatician',
    summary: 'Container image failed HealthOmics verification.',
    action: 'Re-pull and re-push the image to ECR, then retry the run.',
  },
  INVALID_ECR_IMAGE_URI: {
    owner: 'Bioinformatician',
    summary: 'ECR image URI in the workflow definition is malformed.',
    action: 'Fix the image URI format in the workflow definition.',
  },
  INVALID_TASK_RESOURCE_VALUE: {
    owner: 'Bioinformatician',
    summary: 'CPU, memory, or GPU value in the workflow is out of the supported range.',
    action: 'Adjust the resource values in the workflow definition.',
  },
  OUT_OF_MEMORY_ERROR: {
    owner: 'Bioinformatician',
    summary: 'A task ran out of memory during execution.',
    action: 'Increase the memory allocation for the failing task in the workflow definition.',
  },
  RUN_TIMED_OUT: {
    owner: 'Bioinformatician',
    summary: 'The run exceeded its configured timeout.',
    action: 'Increase the run timeout or optimise the workflow to finish sooner.',
  },
  TASK_TIMED_OUT: {
    owner: 'Bioinformatician',
    summary: 'A specific task exceeded its configured timeout.',
    action: 'Increase the task timeout in the workflow definition.',
  },
  WORKFLOW_VER_VALIDATION_FAILED: {
    owner: 'Bioinformatician',
    summary: 'Nextflow version used by the workflow is not supported by HealthOmics.',
    action: 'Update the workflow to a HealthOmics-supported Nextflow version.',
  },
  UNSUPPORTED_GPU_INSTANCE_TYPE: {
    owner: 'Bioinformatician',
    summary: 'Requested GPU instance type is unavailable in this region.',
    action: 'Pick a GPU instance type supported in this region.',
  },
  FILE_SYSTEM_OUT_OF_SPACE: {
    owner: 'Bioinformatician',
    summary: "The run's static file system ran out of space.",
    action: 'Increase the static file system size for the run.',
  },
  IMPORT_FAILED: {
    owner: 'Lab',
    summary: "Input file is missing or the run role can't access it.",
    action: 'Verify the input file exists and the S3 path is correct.',
  },
  INPUT_URI_NOT_FOUND: {
    owner: 'Lab',
    summary: 'Provided input URI does not exist.',
    action: 'Check the input URI and confirm the run role can access it.',
  },
  INACTIVE_OMICS_STORAGE_RESOURCE: {
    owner: 'Lab',
    summary: 'HealthOmics read set is not in ACTIVE state.',
    action: 'Activate the read set before retrying the run.',
  },
  MODIFIED_INPUT_RESOURCE: {
    owner: 'Lab',
    summary: 'An input file was modified after the run started.',
    action: 'Retry the run and avoid modifying inputs while it is running.',
  },
  UNSUPPORTED_INPUT_SIZE: {
    owner: 'Lab',
    summary: 'Total input size is too large for HealthOmics.',
    action: 'Reduce the input size or split the run into smaller batches.',
  },
  EXPORT_FAILED: {
    owner: 'Ambiguous',
    summary: 'Output bucket is missing or the run role lacks write permission.',
    action: 'Verify the output bucket exists and the run role has write access.',
  },
  INVALID_URI_INPUT: {
    owner: 'Ambiguous',
    summary: 'A URI in the run inputs is malformed.',
    action: 'Check the URI format and confirm it is reachable by the run role.',
  },
  INSTANCE_RESERVATION_FAILED: {
    owner: 'AWS',
    summary: 'AWS could not reserve compute capacity for the run.',
    action: 'Wait a few minutes and retry the run.',
  },
  SERVICE_ERROR: {
    owner: 'AWS',
    summary: 'Transient AWS service error.',
    action: 'Retry the run.',
  },
};

/**
 * Look up a deterministic classification for a HealthOmics `failureReason` code.
 *
 * Returns `null` if the code is unknown or intentionally excluded
 * (`WORKFLOW_RUN_FAILED`, `RUN_TASK_FAILED`) — in those cases callers should
 * fall back to the LLM classifier.
 */
export function classifyHealthOmicsFailure(failureReason: string | undefined | null): ClassificationResult | null {
  if (!failureReason) return null;
  return HEALTHOMICS_FAILURE_LOOKUP[failureReason] ?? null;
}
