import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';

import { ClassificationError, ClassificationOutcome, classified, failed } from './classification-outcome';
import { ClassificationInput, LLMClassificationProvider } from './llm-classification-provider';
import { parseClassificationResponse } from './parse-classification-response';
import { buildUserMessage, CLASSIFICATION_SYSTEM_PROMPT } from './prompts/classification-prompt';

/**
 * Bedrock signals failure through SDK exception names rather than HTTP status
 * codes, so it maps separately from the OpenAI / Anthropic providers.
 *
 * `AccessDeniedException` is kept distinct from `INVALID_MODEL_ID` because it
 * is the common Bedrock case — a real model ID that is not enabled in this
 * account or region — and the user's fix is completely different.
 */
export function mapBedrockError(error: unknown): ClassificationError {
  const name = (error as { name?: string })?.name ?? '';
  switch (name) {
    case 'ValidationException':
    case 'ResourceNotFoundException':
      return {
        code: 'INVALID_MODEL_ID',
        message: 'Bedrock does not recognise the configured model ID in this region.',
        retryable: false,
      };
    case 'AccessDeniedException':
      return {
        code: 'MODEL_ACCESS_DENIED',
        message: 'This AWS account does not have model access to the configured Bedrock model.',
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
        message: 'The Bedrock request failed for an unrecognised reason.',
        retryable: false,
      };
  }
}

/**
 * Bedrock-backed implementation. Uses the Anthropic Messages API format
 * (Claude on Bedrock). No API key required — relies on the Lambda execution
 * role's `bedrock:InvokeModel` permission.
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
    const commandInput: InvokeModelCommandInput = {
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(
        JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 512,
          temperature: 0,
          system: CLASSIFICATION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [{ type: 'text', text: buildUserMessage(input) }] }],
        }),
      ),
    };

    let responseText: string;
    try {
      const response = await this.client.send(new InvokeModelCommand(commandInput));
      const parsed = JSON.parse(new TextDecoder().decode(response.body));
      responseText = parsed?.content?.[0]?.text ?? '';
    } catch (error) {
      const mapped = mapBedrockError(error);
      return failed(mapped.code, mapped.message, mapped.retryable);
    }

    const result = parseClassificationResponse(responseText);
    if (!result) {
      return failed('UNPARSEABLE_RESPONSE', 'The model returned a response that could not be parsed.', true);
    }
    return classified(result);
  }

  public async validateConfig(): Promise<ClassificationError | null> {
    throw new Error('not implemented until Task 6');
  }
}

// Re-export so existing tests that import `parseClassificationResponse` from
// here continue to work without churn.
export { parseClassificationResponse };
