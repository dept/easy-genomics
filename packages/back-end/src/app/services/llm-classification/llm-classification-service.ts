import { AnthropicClassificationProvider } from './anthropic-classification-provider';
import { BedrockClassificationProvider } from './bedrock-classification-provider';
import { ClassificationError, ClassificationOutcome, failed } from './classification-outcome';
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
 * `classify()` returns an explicit `CONFIG_INCOMPLETE` failure whenever the
 * supplied config is unusable (missing model id, missing key for a
 * key-required provider, etc.) — it never no-ops, so callers must handle the
 * failed outcome rather than assume classification always ran.
 */
export class LLMClassificationService {
  public async classify(input: ClassificationInput, config: ProviderConfig): Promise<ClassificationOutcome> {
    const provider = this.buildProvider(config);
    if (!provider) {
      return failed('CONFIG_INCOMPLETE', 'AI failure analysis is not fully configured for this laboratory.', false);
    }
    return provider.classify(input);
  }

  /**
   * Live probe used by `update-laboratory` before a provider config is stored.
   * Returns null when the config works, or the reason it does not.
   */
  public async validateConfig(config: ProviderConfig): Promise<ClassificationError | null> {
    const provider = this.buildProvider(config);
    if (!provider) {
      return {
        code: 'CONFIG_INCOMPLETE',
        message: 'AI failure analysis is not fully configured for this laboratory.',
        retryable: false,
      };
    }
    return provider.validateConfig();
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
