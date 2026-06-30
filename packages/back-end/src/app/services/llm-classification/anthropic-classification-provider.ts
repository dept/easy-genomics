import { ClassificationResult } from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';

import { AMBIGUOUS_FALLBACK } from './bedrock-classification-provider';
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

  public async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const body = {
      model: this.modelId,
      max_tokens: 512,
      temperature: 0,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildUserMessage(input) }],
        },
      ],
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
        console.error(
          '[anthropic-classification-provider] Anthropic API non-2xx:',
          response.status,
          await response.text(),
        );
        return AMBIGUOUS_FALLBACK;
      }
      const parsed = (await response.json()) as any;
      responseText = parsed?.content?.[0]?.text ?? '';
    } catch (error) {
      console.error('[anthropic-classification-provider] Anthropic request failed:', error);
      return AMBIGUOUS_FALLBACK;
    }

    return parseClassificationResponse(responseText) ?? AMBIGUOUS_FALLBACK;
  }
}
