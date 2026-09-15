import { ClassificationResult, FailureOwner } from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';

/**
 * Input the classifier sees per failure. Both platforms feed into the same
 * provider so prompts can be unified; provider-specific shaping happens upstream.
 */
export interface ClassificationInput {
  platform: 'AWS HealthOmics' | 'Seqera Cloud';
  failureReason?: string; // HealthOmics machine code (e.g. WORKFLOW_RUN_FAILED) or undefined for Seqera
  statusMessage?: string; // HealthOmics human-readable message (often contains task name + log link)
  errorMessage?: string; // Seqera workflow.errorMessage (free-text Nextflow error)
  errorReport?: string; // Seqera workflow.errorReport (truncated by caller before passing in)
  workflowName?: string; // Hint for the LLM (e.g. 'nf-core/rnaseq')
  logExcerpt?: string; // Redacted, bounded run-log excerpt (PII/secrets already stripped by caller)
}

/**
 * Pluggable provider contract. Implementations:
 * - {@link BedrockClassificationProvider} — only one wired up on day one.
 * Future: OpenAI, direct Anthropic. Add a new class + a branch in the
 * {@link LLMClassificationService} facade and the corresponding IAM/secrets in CDK.
 */
export interface LLMClassificationProvider {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
}

export type { ClassificationResult, FailureOwner };
