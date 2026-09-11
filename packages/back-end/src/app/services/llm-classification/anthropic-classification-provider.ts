import {
  ClassificationError,
  ClassificationOutcome,
  classified,
  failed,
  mapHttpStatusToError,
} from './classification-outcome';
import { ClassificationInput, LLMClassificationProvider } from './llm-classification-provider';
import { parseClassificationResponse } from './parse-classification-response';
import { buildUserMessage, CLASSIFICATION_SYSTEM_PROMPT } from './prompts/classification-prompt';

/**
 * Direct Anthropic Messages API implementation. Posts to `/v1/messages` with
 * the same system prompt + user message used by the Bedrock provider; the
 * shared parser then validates the JSON shape.
 */
export class AnthropicClassificationProvider implements LLMClassificationProvider {
  public constructor(
    private readonly modelId: string,
    private readonly apiKey: string,
    private readonly endpoint: string = 'https://api.anthropic.com/v1/messages',
  ) {}

  public async classify(input: ClassificationInput): Promise<ClassificationOutcome> {
    const body = {
      model: this.modelId,
      max_tokens: 512,
      temperature: 0,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildUserMessage(input) }] }],
    };

    let responseText: string;
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // The response body is deliberately not included: it can echo the
        // submitted key, and this message reaches the UI.
        const mapped = mapHttpStatusToError('anthropic', response.status);
        return failed(mapped.code, mapped.message, mapped.retryable);
      }
      const parsed = (await response.json()) as any;
      responseText = parsed?.content?.[0]?.text ?? '';
    } catch (error) {
      return failed('PROVIDER_UNAVAILABLE', 'The Anthropic request could not be completed.', true);
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
