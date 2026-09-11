/**
 * Maps a ClassificationErrorCode to copy a technician can act on. Every message
 * names both the cause and where the fix lives — the previous behaviour was to
 * show nothing at all, so vagueness here would be barely an improvement.
 */
const MESSAGES: Record<string, string> = {
  INVALID_MODEL_ID: "The model ID configured for this lab isn't valid for {provider}. Check it in Lab Settings.",
  MODEL_ACCESS_DENIED:
    'This AWS account does not have access to that Bedrock model in this region. Enable model access in the Bedrock console.',
  AUTH_FAILED: 'The {provider} API key for this lab was rejected. Update it in Lab Settings.',
  RATE_LIMITED: '{provider} rate-limited the request. Try again in a moment.',
  PROVIDER_UNAVAILABLE: '{provider} is currently unavailable. Try again later.',
  UNPARSEABLE_RESPONSE: "The model returned a response that couldn't be read. Try again, or try a different model.",
  CONFIG_INCOMPLETE:
    'AI failure analysis is not configured for this lab. Set a provider, model, and API key in Lab Settings.',
};

const GENERIC = 'AI failure analysis could not be completed. Please try again.';

export function analysisErrorMessage(code: string | undefined, provider?: string): string {
  const template = code ? MESSAGES[code] : undefined;
  if (!template) return GENERIC;
  return template.replace(/\{provider\}/g, provider || 'The AI provider');
}
