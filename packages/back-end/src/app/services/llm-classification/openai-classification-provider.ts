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
 * OpenAI chat-completions implementation. Calls `/v1/chat/completions` with
 * `response_format: { type: 'json_object' }` so the model is constrained to
 * emit JSON; the shared parser then validates the shape.
 */
export class OpenAIClassificationProvider implements LLMClassificationProvider {
  public constructor(
    private readonly modelId: string,
    private readonly apiKey: string,
    private readonly endpoint: string = 'https://api.openai.com/v1/chat/completions',
  ) {}

  public async classify(input: ClassificationInput): Promise<ClassificationOutcome> {
    const body = {
      model: this.modelId,
      temperature: 0,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input) },
      ],
    };

    let responseText: string;
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // The response body is deliberately not included in the error message:
        // it can echo the submitted key, and this message reaches the UI.
        const mapped = mapHttpStatusToError('openai', response.status);
        return failed(mapped.code, mapped.message, mapped.retryable);
      }
      const parsed = (await response.json()) as any;
      responseText = parsed?.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      return failed('PROVIDER_UNAVAILABLE', 'The OpenAI request could not be completed.', true);
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
