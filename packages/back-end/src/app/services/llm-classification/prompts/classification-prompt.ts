import { ClassificationInput } from '../llm-classification-provider';

/**
 * Maximum characters of free-text fields we send to the LLM. Long Seqera error
 * reports occasionally contain massive stack traces — truncating keeps token
 * usage bounded and avoids hitting model context limits.
 */
const MAX_FIELD_CHARS = 4000;

const truncate = (value: string | undefined, max = MAX_FIELD_CHARS): string =>
  !value ? '' : value.length <= max ? value : `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;

export const CLASSIFICATION_SYSTEM_PROMPT = `You are an expert AWS HealthOmics and Nextflow Tower (Seqera Cloud) failure triager for a clinical genomics platform. Your only job is to look at a single failed run and return a JSON object that helps the user decide who needs to act.

Owners:
- "Lab" — the user supplied bad inputs, bad sample sheet, missing S3 files, files too large.
- "Bioinformatician" — the workflow definition, container image, resource sizing, or platform setup is wrong.
- "AWS" — a transient AWS service or capacity issue that retrying typically resolves.
- "Ambiguous" — you cannot tell from the evidence; the user must look at CloudWatch logs.

You will reply with a single JSON object and nothing else. Schema:
{
  "owner": "Lab" | "Bioinformatician" | "AWS" | "Ambiguous",
  "summary": string  // <= 200 characters, one sentence, no markdown
  "action": string   // <= 300 characters, imperative voice, what to do next
}

Rules:
- If a HealthOmics task name appears in the message (e.g. SAMPLESHEET_CHECK, FASTQC, MULTIQC) and clearly points at user data, choose "Lab".
- If the message references container, ECR, image, role assumption, resource limits, or workflow validation, choose "Bioinformatician".
- If the message mentions capacity, throttling, or a transient AWS issue, choose "AWS".
- If the only signal is a generic engine failure with no actionable detail, choose "Ambiguous" and tell the user to check CloudWatch logs.
- Do NOT invent task names, file paths, or AWS resources that are not in the input.
- Do NOT include any prose outside the JSON object.`;

export function buildUserMessage(input: ClassificationInput): string {
  const parts: string[] = [];
  parts.push(`Platform: ${input.platform}`);
  if (input.workflowName) parts.push(`Workflow: ${input.workflowName}`);
  if (input.failureReason) parts.push(`failureReason: ${input.failureReason}`);
  if (input.statusMessage) parts.push(`statusMessage:\n${truncate(input.statusMessage)}`);
  if (input.errorMessage) parts.push(`errorMessage:\n${truncate(input.errorMessage)}`);
  if (input.errorReport) parts.push(`errorReport:\n${truncate(input.errorReport)}`);
  parts.push('Return only the JSON object described in the system prompt.');
  return parts.join('\n\n');
}
