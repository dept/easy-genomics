import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { ClassificationResult } from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';

import { ClassificationInput, LLMClassificationProvider } from './llm-classification-provider';
import { parseClassificationResponse } from './parse-classification-response';
import { buildUserMessage, CLASSIFICATION_SYSTEM_PROMPT } from './prompts/classification-prompt';

export const AMBIGUOUS_FALLBACK: ClassificationResult = {
  owner: 'Ambiguous',
  summary: 'The failure could not be classified automatically.',
  action: 'Review the run in CloudWatch logs or the Seqera console to identify the root cause.',
};

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

  public async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
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

    const commandInput: InvokeModelCommandInput = {
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(JSON.stringify(payload)),
    };

    let responseText: string;
    try {
      const response = await this.client.send(new InvokeModelCommand(commandInput));
      const decoded = new TextDecoder().decode(response.body);
      const parsed = JSON.parse(decoded);
      responseText = parsed?.content?.[0]?.text ?? '';
    } catch (error) {
      console.error('[bedrock-classification-provider] Bedrock InvokeModel failed:', error);
      return AMBIGUOUS_FALLBACK;
    }

    return parseClassificationResponse(responseText) ?? AMBIGUOUS_FALLBACK;
  }
}

// Re-export so existing tests that import `parseClassificationResponse` from
// here continue to work without churn.
export { parseClassificationResponse };
