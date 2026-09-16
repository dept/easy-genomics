import { BedrockRuntimeClient, ConverseCommand, ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';

import { ClassificationError, ClassificationOutcome, classified, failed } from './classification-outcome';
import { ClassificationInput, LLMClassificationProvider } from './llm-classification-provider';
import { parseClassificationResponse } from './parse-classification-response';
import { buildUserMessage, CLASSIFICATION_SYSTEM_PROMPT } from './prompts/classification-prompt';

/**
 * Bedrock rejections that are account-configuration problems an admin can act
 * on, none of which is obvious from the exception name alone. Matched on
 * Bedrock's own wording rather than exception type, because one exception name
 * covers unrelated causes — AccessDeniedException alone spans an IAM gap, an
 * SCP, and a missing Marketplace subscription, which need different fixes.
 */
const BEDROCK_REMEDIATIONS: { matches: RegExp; advice: string }[] = [
  {
    matches: /use case details/i,
    advice:
      'Submit the one-time Anthropic use case details form in the Bedrock console (Model catalog → any Anthropic model), then retry in ~15 minutes. Amazon Nova models need no form.',
  },
  {
    matches: /on-demand throughput isn.t supported|inference profile/i,
    advice:
      'This model is only served through a cross-region inference profile — prefix the model ID with `us.` (for example us.anthropic.claude-sonnet-4-5-20250929-v1:0).',
  },
  // Checked before the broader authorisation match: a Marketplace model also
  // reports as an authorisation failure, but subscribing is the fix, not IAM.
  {
    matches: /subscri/i,
    advice: 'This is an AWS Marketplace model. Subscribe to it in the Bedrock console before configuring it here.',
  },
  {
    matches: /not authorized to perform/i,
    advice:
      "The Lambda's execution role or a Service Control Policy is blocking this model. Check that the bedrock:InvokeModel grant covers both the inference-profile ARN and the foundation-model ARN in the region the profile routes to.",
  },
];

/**
 * Appends Bedrock's own explanation, which is specific enough to act on, plus
 * remediation steps when the cause is a known account-configuration problem.
 */
function withBedrockDetail(summary: string, error: unknown): string {
  const detail = (error as { message?: string })?.message?.trim();
  if (!detail) return summary;

  const remediation = BEDROCK_REMEDIATIONS.find(({ matches }) => matches.test(detail));
  return remediation ? `${summary} ${detail} ${remediation.advice}` : `${summary} ${detail}`;
}

/**
 * Bedrock signals failure through SDK exception names rather than HTTP status
 * codes, so it maps separately from the OpenAI / Anthropic providers.
 *
 * Every message carries Bedrock's own text. Without it a `ValidationException`
 * asking for an inference profile and a `ResourceNotFoundException` asking for
 * the Anthropic use-case form both read as "unknown model ID", which sends
 * admins hunting for a model ID that was never the problem.
 */
export function mapBedrockError(error: unknown): ClassificationError {
  const name = (error as { name?: string })?.name ?? '';
  switch (name) {
    case 'ValidationException':
      return {
        code: 'INVALID_MODEL_ID',
        message: withBedrockDetail('Bedrock rejected the configured model ID.', error),
        retryable: false,
      };
    // Raised when the model exists but this account cannot reach it yet — most
    // often the one-time Anthropic use-case form, or an inference profile that
    // does not exist in this region.
    case 'ResourceNotFoundException':
      return {
        code: 'MODEL_ACCESS_DENIED',
        message: withBedrockDetail('Bedrock could not resolve the configured model for this account.', error),
        retryable: false,
      };
    case 'AccessDeniedException':
      return {
        code: 'MODEL_ACCESS_DENIED',
        message: withBedrockDetail(
          'This AWS account does not have model access to the configured Bedrock model.',
          error,
        ),
        retryable: false,
      };
    case 'ThrottlingException':
    case 'TooManyRequestsException':
      return { code: 'RATE_LIMITED', message: 'Bedrock rate-limited the request.', retryable: true };
    case 'ServiceUnavailableException':
    case 'InternalServerException':
    case 'ModelTimeoutException':
      return { code: 'PROVIDER_UNAVAILABLE', message: 'Bedrock is temporarily unavailable.', retryable: true };
    default:
      return {
        code: 'PROVIDER_UNAVAILABLE',
        message: withBedrockDetail('The Bedrock request failed for an unrecognised reason.', error),
        retryable: false,
      };
  }
}

/**
 * Bedrock-backed implementation. Uses the Converse API, which normalises the
 * request and response shape across every Bedrock model family — `InvokeModel`
 * is a raw passthrough whose body format is specific to the model vendor, so it
 * would restrict this provider to Anthropic models only.
 *
 * No API key required — relies on the Lambda execution role's
 * `bedrock:InvokeModel` permission, which is also what authorises Converse.
 */
export class BedrockClassificationProvider implements LLMClassificationProvider {
  private readonly client: BedrockRuntimeClient;

  public constructor(
    private readonly modelId: string,
    region?: string,
  ) {
    this.client = new BedrockRuntimeClient(region ? { region } : {});
  }

  public async classify(input: ClassificationInput): Promise<ClassificationOutcome> {
    const commandInput: ConverseCommandInput = {
      modelId: this.modelId,
      system: [{ text: CLASSIFICATION_SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: [{ text: buildUserMessage(input) }] }],
      inferenceConfig: { maxTokens: 512, temperature: 0 },
    };

    let responseText: string;
    try {
      const response = await this.client.send(new ConverseCommand(commandInput));
      responseText = response.output?.message?.content?.[0]?.text ?? '';
    } catch (error) {
      console.error(`Bedrock classification request failed for model ${this.modelId}`, error);
      const mapped = mapBedrockError(error);
      return failed(mapped.code, mapped.message, mapped.retryable);
    }

    const result = parseClassificationResponse(responseText);
    if (!result) {
      return failed('UNPARSEABLE_RESPONSE', 'The model returned a response that could not be parsed.', true);
    }
    return classified(result);
  }

  /**
   * Smallest call that still exercises the model ID and this Lambda's Bedrock
   * permissions: one token, no prompt of substance.
   */
  public async validateConfig(): Promise<ClassificationError | null> {
    try {
      await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages: [{ role: 'user', content: [{ text: 'ping' }] }],
          inferenceConfig: { maxTokens: 1 },
        }),
      );
      return null;
    } catch (error) {
      // Logged here because the caller maps this to a 400 and discards the
      // cause, leaving CloudWatch with no record of why a save was rejected.
      console.error(`Bedrock configuration probe failed for model ${this.modelId}`, error);
      return mapBedrockError(error);
    }
  }
}

// Re-export so existing tests that import `parseClassificationResponse` from
// here continue to work without churn.
export { parseClassificationResponse };
