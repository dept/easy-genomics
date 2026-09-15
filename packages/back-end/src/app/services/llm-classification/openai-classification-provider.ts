import { ClassificationResult } from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';

import { AMBIGUOUS_FALLBACK } from './bedrock-classification-provider';
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

  public async classify(input: ClassificationInput): Promise<ClassificationResult> {
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
        console.error('[openai-classification-provider] OpenAI API non-2xx:', response.status, await response.text());
        return AMBIGUOUS_FALLBACK;
      }
      const parsed = (await response.json()) as any;
      responseText = parsed?.choices?.[0]?.message?.content ?? '';
    } catch (error) {
      console.error('[openai-classification-provider] OpenAI request failed:', error);
      return AMBIGUOUS_FALLBACK;
    }

    return parseClassificationResponse(responseText) ?? AMBIGUOUS_FALLBACK;
  }
}
