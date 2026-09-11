import { ClassificationResult } from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';

export type LlmProviderName = 'bedrock' | 'openai' | 'anthropic';

/**
 * Why the LLM path could not produce a classification. Distinct from a
 * classification of `Ambiguous`, which means the model answered and could not
 * decide — merging the two is what made invalid model IDs fail silently.
 */
export type ClassificationErrorCode =
  | 'INVALID_MODEL_ID'
  | 'MODEL_ACCESS_DENIED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNPARSEABLE_RESPONSE'
  | 'CONFIG_INCOMPLETE';

export interface ClassificationError {
  code: ClassificationErrorCode;
  /** Safe to surface to a user and to store. Never contains the API key. */
  message: string;
  retryable: boolean;
}

export type ClassificationOutcome =
  | { outcome: 'classified'; result: ClassificationResult }
  | { outcome: 'failed'; error: ClassificationError };

export const AMBIGUOUS_FALLBACK: ClassificationResult = {
  owner: 'Ambiguous',
  summary: 'The failure could not be classified automatically.',
  action: 'Review the run in CloudWatch logs or the Seqera console to identify the root cause.',
};

export function classified(result: ClassificationResult): ClassificationOutcome {
  return { outcome: 'classified', result };
}

export function failed(code: ClassificationErrorCode, message: string, retryable: boolean): ClassificationOutcome {
  return { outcome: 'failed', error: { code, message, retryable } };
}

/**
 * Shared by the OpenAI and Anthropic providers, which both signal failure
 * through HTTP status codes. Bedrock signals through SDK exception names and
 * maps separately.
 */
export function mapHttpStatusToError(provider: LlmProviderName, status: number): ClassificationError {
  if (status === 404) {
    return {
      code: 'INVALID_MODEL_ID',
      message: `The ${provider} API does not recognise the configured model ID.`,
      retryable: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: 'AUTH_FAILED',
      message: `The ${provider} API key was rejected.`,
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: `The ${provider} API rate-limited the request.`,
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      code: 'PROVIDER_UNAVAILABLE',
      message: `The ${provider} API returned ${status}.`,
      retryable: true,
    };
  }
  return {
    code: 'PROVIDER_UNAVAILABLE',
    message: `The ${provider} API returned an unexpected status ${status}.`,
    retryable: false,
  };
}
