import { AnthropicClassificationProvider } from '../../../../src/app/services/llm-classification/anthropic-classification-provider';
import { BedrockClassificationProvider } from '../../../../src/app/services/llm-classification/bedrock-classification-provider';
import { AMBIGUOUS_FALLBACK } from '../../../../src/app/services/llm-classification/classification-outcome';
import { ClassificationInput } from '../../../../src/app/services/llm-classification/llm-classification-provider';
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

describe('LLMClassificationService.classify', () => {
  const service = new LLMClassificationService();
  const input: ClassificationInput = { platform: 'AWS HealthOmics', failureReason: 'WORKFLOW_RUN_FAILED' };

  it('returns CONFIG_INCOMPLETE when the model id is missing', async () => {
    const result = await service.classify(input, { provider: 'bedrock', modelId: '' });
    expect(result).toEqual({
      outcome: 'failed',
      error: {
        code: 'CONFIG_INCOMPLETE',
        message: 'AI failure analysis is not fully configured for this laboratory.',
        retryable: false,
      },
    });
  });

  it('returns CONFIG_INCOMPLETE when a key-required provider has no key', async () => {
    const result = await service.classify(input, { provider: 'openai', modelId: 'gpt-4o-mini' });
    expect(result.outcome === 'failed' && result.error.code).toBe('CONFIG_INCOMPLETE');
  });

  it('delegates to the built provider when the config is complete', async () => {
    const classify = jest.fn().mockResolvedValue({ outcome: 'classified', result: AMBIGUOUS_FALLBACK });
    jest.spyOn(service, 'buildProvider').mockReturnValue({ classify, validateConfig: jest.fn() });

    const result = await service.classify(input, { provider: 'bedrock', modelId: 'a-model' });
    expect(classify).toHaveBeenCalledWith(input);
    expect(result.outcome).toBe('classified');
  });
});

describe('LLMClassificationService.validateConfig', () => {
  const service = new LLMClassificationService();

  it('returns CONFIG_INCOMPLETE without probing when the config is incomplete', async () => {
    const error = await service.validateConfig({ provider: 'openai', modelId: 'gpt-4o-mini' });
    expect(error?.code).toBe('CONFIG_INCOMPLETE');
  });

  it('delegates to the provider probe when the config is complete', async () => {
    const validateConfig = jest.fn().mockResolvedValue(null);
    jest.spyOn(service, 'buildProvider').mockReturnValue({ classify: jest.fn(), validateConfig });
    await expect(service.validateConfig({ provider: 'bedrock', modelId: 'a-model' })).resolves.toBeNull();
    expect(validateConfig).toHaveBeenCalled();
  });
});
