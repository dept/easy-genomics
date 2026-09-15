import { ClassificationResult } from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';

import { AnthropicClassificationProvider } from './anthropic-classification-provider';
import { BedrockClassificationProvider, AMBIGUOUS_FALLBACK } from './bedrock-classification-provider';
import { ClassificationInput, LLMClassificationProvider } from './llm-classification-provider';
import { OpenAIClassificationProvider } from './openai-classification-provider';

export interface ProviderConfig {
  provider: 'bedrock' | 'openai' | 'anthropic';
  modelId: string;
  /** Required for openai / anthropic. Ignored for bedrock (uses Lambda IAM). */
  apiKey?: string;
  /** Optional region override for Bedrock. Falls back to the Lambda region. */
  bedrockRegion?: string;
}

/**
 * Facade Lambdas call. Builds the right provider per request from a
 * per-Laboratory ProviderConfig — there is no env-var fallback. Each lab
 * brings its own provider, model, and (for non-Bedrock) API key.
 *
 * `classify()` short-circuits with a no-op result whenever the supplied
 * config is unusable (missing model id, missing key for a key-required
 * provider, etc.) so callers can invoke it defensively.
 */
export class LLMClassificationService {
  public async classify(input: ClassificationInput, config: ProviderConfig): Promise<ClassificationResult> {
    const provider = this.buildProvider(config);
    if (!provider) return AMBIGUOUS_FALLBACK;
    return provider.classify(input);
  }

  /** Exposed for testing. Returns null when the config is incomplete or the provider is unsupported. */
  public buildProvider(config: ProviderConfig): LLMClassificationProvider | null {
    if (!config.modelId) {
      console.warn('[llm-classification-service] Missing modelId; skipping classification.');
      return null;
    }
    switch (config.provider) {
      case 'bedrock':
        return new BedrockClassificationProvider(config.modelId, config.bedrockRegion);
      case 'openai':
        if (!config.apiKey) {
          console.warn('[llm-classification-service] OpenAI provider requires an API key; skipping.');
          return null;
        }
        return new OpenAIClassificationProvider(config.modelId, config.apiKey);
      case 'anthropic':
        if (!config.apiKey) {
          console.warn('[llm-classification-service] Anthropic provider requires an API key; skipping.');
          return null;
        }
        return new AnthropicClassificationProvider(config.modelId, config.apiKey);
      default:
        console.warn(`[llm-classification-service] Unknown provider "${(config as ProviderConfig).provider}".`);
        return null;
    }
  }
}
