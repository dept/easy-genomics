import { analysisErrorMessage } from '@FE/utils/analysis-error-message';

describe('analysisErrorMessage', () => {
  it('names the provider and where to fix an invalid model id', () => {
    const message = analysisErrorMessage('INVALID_MODEL_ID', 'Bedrock');
    expect(message).toContain('Bedrock');
    expect(message).toContain('Lab Settings');
  });

  it('distinguishes denied model access from an invalid model id', () => {
    expect(analysisErrorMessage('MODEL_ACCESS_DENIED')).not.toBe(analysisErrorMessage('INVALID_MODEL_ID'));
    expect(analysisErrorMessage('MODEL_ACCESS_DENIED')).toContain('Bedrock console');
  });

  it('has copy for every known code', () => {
    const codes = [
      'INVALID_MODEL_ID',
      'MODEL_ACCESS_DENIED',
      'AUTH_FAILED',
      'RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'UNPARSEABLE_RESPONSE',
      'CONFIG_INCOMPLETE',
    ];
    for (const code of codes) {
      expect(analysisErrorMessage(code).length).toBeGreaterThan(0);
      expect(analysisErrorMessage(code)).not.toContain('{provider}');
    }
  });

  it('reads as a complete sentence for AUTH_FAILED with no provider given', () => {
    const message = analysisErrorMessage('AUTH_FAILED');
    expect(message).not.toContain('The The');
    expect(message).toBe('Authentication with the configured provider failed. Update the API key in Lab Settings.');
  });

  it('reads correctly for AUTH_FAILED when a real provider name is given', () => {
    expect(analysisErrorMessage('AUTH_FAILED', 'OpenAI')).toBe(
      'Authentication with OpenAI failed. Update the API key in Lab Settings.',
    );
  });

  it('falls back to a generic message for an unknown or missing code', () => {
    expect(analysisErrorMessage(undefined)).toBe('AI failure analysis could not be completed. Please try again.');
    expect(analysisErrorMessage('SOMETHING_NEW')).toBe('AI failure analysis could not be completed. Please try again.');
  });
});
