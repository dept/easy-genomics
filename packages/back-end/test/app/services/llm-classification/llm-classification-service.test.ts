import { AnthropicClassificationProvider } from '../../../../src/app/services/llm-classification/anthropic-classification-provider';
import { BedrockClassificationProvider } from '../../../../src/app/services/llm-classification/bedrock-classification-provider';
import { LLMClassificationService } from '../../../../src/app/services/llm-classification/llm-classification-service';
import { OpenAIClassificationProvider } from '../../../../src/app/services/llm-classification/openai-classification-provider';

describe('LLMClassificationService.buildProvider', () => {
  const service = new LLMClassificationService();

  it('returns BedrockClassificationProvider for provider: bedrock (no key needed)', () => {
    const provider = service.buildProvider({
      provider: 'bedrock',
      modelId: 'anthropic.claude-haiku-4-5-20251001',
      bedrockRegion: 'us-east-1',
    });
    expect(provider).toBeInstanceOf(BedrockClassificationProvider);
  });

  it('returns OpenAIClassificationProvider when apiKey supplied', () => {
    const provider = service.buildProvider({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      apiKey: 'sk-test',
    });
    expect(provider).toBeInstanceOf(OpenAIClassificationProvider);
  });

  it('returns AnthropicClassificationProvider when apiKey supplied', () => {
    const provider = service.buildProvider({
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5-20251001',
      apiKey: 'sk-ant-test',
    });
    expect(provider).toBeInstanceOf(AnthropicClassificationProvider);
  });

  it('returns null when openai is selected but no apiKey is supplied', () => {
    const provider = service.buildProvider({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
    });
    expect(provider).toBeNull();
  });

  it('returns null when anthropic is selected but no apiKey is supplied', () => {
    const provider = service.buildProvider({
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5-20251001',
    });
    expect(provider).toBeNull();
  });

  it('returns null when modelId is missing', () => {
    const provider = service.buildProvider({
      provider: 'bedrock',
      modelId: '',
    });
    expect(provider).toBeNull();
  });
});
