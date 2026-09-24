import {
  AMBIGUOUS_FALLBACK,
  classified,
  failed,
  mapHttpStatusToError,
} from '../../../../src/app/services/llm-classification/classification-outcome';

describe('classification-outcome helpers', () => {
  it('wraps a result as a classified outcome', () => {
    const outcome = classified(AMBIGUOUS_FALLBACK);
    expect(outcome).toEqual({ outcome: 'classified', result: AMBIGUOUS_FALLBACK });
  });

  it('wraps an error as a failed outcome', () => {
    const outcome = failed('AUTH_FAILED', 'nope', false);
    expect(outcome).toEqual({
      outcome: 'failed',
      error: { code: 'AUTH_FAILED', message: 'nope', retryable: false },
    });
  });
});

describe('mapHttpStatusToError', () => {
  it('maps 404 to an invalid model id', () => {
    const error = mapHttpStatusToError('openai', 404);
    expect(error.code).toBe('INVALID_MODEL_ID');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('openai');
  });

  it('maps 401 and 403 to an auth failure', () => {
    expect(mapHttpStatusToError('anthropic', 401).code).toBe('AUTH_FAILED');
    expect(mapHttpStatusToError('anthropic', 403).code).toBe('AUTH_FAILED');
  });

  it('maps 429 to a retryable rate limit', () => {
    const error = mapHttpStatusToError('openai', 429);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
  });

  it('maps 5xx to a retryable provider outage', () => {
    expect(mapHttpStatusToError('openai', 500).code).toBe('PROVIDER_UNAVAILABLE');
    expect(mapHttpStatusToError('anthropic', 529).retryable).toBe(true);
  });

  it('falls back to a non-retryable provider error for anything else', () => {
    const error = mapHttpStatusToError('openai', 418);
    expect(error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(error.retryable).toBe(false);
  });
});
