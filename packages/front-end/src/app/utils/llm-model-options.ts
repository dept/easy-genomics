type LlmProvider = 'bedrock' | 'openai' | 'anthropic';

/**
 * Amazon Nova needs no use-case form and is served on-demand by its bare model
 * id, so it is the only Bedrock family that works in a fresh AWS account with
 * no console steps. Anthropic models require a one-time use case form.
 */
export const DEFAULT_BEDROCK_MODEL_ID = 'amazon.nova-lite-v1:0';

/**
 * Suggestions only — the Model ID field stays free text because AWS and the
 * BYOK providers release models far more often than we ship, and a lab may hold
 * a private or provisioned model that no curated list can know about.
 *
 * Anthropic models appear here only in their `us.` inference-profile form:
 * Bedrock refuses to invoke Claude 4.x by its bare foundation-model id.
 */
const CURATED_MODEL_IDS: Record<LlmProvider, string[]> = {
  bedrock: [
    DEFAULT_BEDROCK_MODEL_ID,
    'amazon.nova-pro-v1:0',
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'meta.llama3-3-70b-instruct-v1:0',
    'mistral.mistral-large-2407-v1:0',
  ],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'],
};

export function llmModelOptionsFor(provider: string | undefined): string[] {
  if (!provider) return [];
  return CURATED_MODEL_IDS[provider as LlmProvider] ?? [];
}

/**
 * A lab may already be saved with a model id outside the curated list. Without
 * this the select would render that saved value as an empty selection.
 */
export function withCustomModelOption(provider: string | undefined, selected: string | undefined): string[] {
  const options = llmModelOptionsFor(provider);
  if (!selected) return options;
  return options.includes(selected) ? options : [...options, selected];
}
