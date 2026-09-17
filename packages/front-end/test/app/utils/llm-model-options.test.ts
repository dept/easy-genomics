import {
  DEFAULT_BEDROCK_MODEL_ID,
  llmModelOptionsFor,
  withCustomModelOption,
} from '../../../src/app/utils/llm-model-options';

describe('llmModelOptionsFor', () => {
  it('returns no options when no provider is selected', () => {
    expect(llmModelOptionsFor(undefined)).toEqual([]);
  });

  it('offers the default Bedrock model first, since it needs no account setup', () => {
    expect(llmModelOptionsFor('bedrock')[0]).toBe(DEFAULT_BEDROCK_MODEL_ID);
  });

  it('offers Anthropic models on Bedrock only as inference profile IDs', () => {
    const anthropicOnBedrock = llmModelOptionsFor('bedrock').filter((id) => id.includes('anthropic'));

    expect(anthropicOnBedrock.length).toBeGreaterThan(0);
    anthropicOnBedrock.forEach((id) => expect(id).toMatch(/^us\.anthropic\./));
  });

  it('offers bare model names for the direct openai and anthropic APIs', () => {
    llmModelOptionsFor('openai').forEach((id) => expect(id).not.toContain('.'));
    llmModelOptionsFor('anthropic').forEach((id) => expect(id).not.toMatch(/^us\./));
  });

  it('never offers the same model id twice for a provider', () => {
    (['bedrock', 'openai', 'anthropic'] as const).forEach((provider) => {
      const options = llmModelOptionsFor(provider);
      expect(new Set(options).size).toBe(options.length);
    });
  });
});

describe('withCustomModelOption', () => {
  it('keeps the curated list as-is when nothing is selected', () => {
    expect(withCustomModelOption('bedrock', undefined)).toEqual(llmModelOptionsFor('bedrock'));
    expect(withCustomModelOption('bedrock', '')).toEqual(llmModelOptionsFor('bedrock'));
  });

  it('does not duplicate a selection that is already curated', () => {
    const options = withCustomModelOption('bedrock', DEFAULT_BEDROCK_MODEL_ID);
    expect(options.filter((id) => id === DEFAULT_BEDROCK_MODEL_ID)).toHaveLength(1);
  });

  it('surfaces a saved model id that is not in the curated list', () => {
    const options = withCustomModelOption('bedrock', 'some.private-model-v9:0');
    expect(options).toContain('some.private-model-v9:0');
  });

  it('returns only the custom value when no provider is selected', () => {
    expect(withCustomModelOption(undefined, 'anything')).toEqual(['anything']);
  });
});
