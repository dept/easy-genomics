import { ClassificationInput } from '../../../../src/app/services/llm-classification/llm-classification-provider';
import { OpenAIClassificationProvider } from '../../../../src/app/services/llm-classification/openai-classification-provider';

describe('OpenAIClassificationProvider', () => {
  const goodResponseBody = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            owner: 'Lab',
            summary: 'Sample sheet invalid',
            action: 'Re-upload a valid sample sheet',
          }),
        },
      },
    ],
  };

  let fetchSpy: jest.SpyInstance;
  let provider: OpenAIClassificationProvider;
  let input: ClassificationInput;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    provider = new OpenAIClassificationProvider('gpt-4o-mini', 'sk-test-key');
    input = { platform: 'Seqera Cloud', errorMessage: 'boom' };
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends Bearer auth header + json_object response_format', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => goodResponseBody,
    } as any);

    await provider.classify(input);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('parses a well-formed completion and returns a classified outcome', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => goodResponseBody,
    } as any);

    const result = await provider.classify(input);
    expect(result.outcome).toBe('classified');
    expect(result.outcome === 'classified' && result.result.owner).toBe('Lab');
    expect(result.outcome === 'classified' && result.result.summary).toBe('Sample sheet invalid');
  });

  it('returns INVALID_MODEL_ID on a 404', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'model not found',
    }) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result).toEqual({
      outcome: 'failed',
      error: {
        code: 'INVALID_MODEL_ID',
        message: 'The openai API does not recognise the configured model ID.',
        retryable: false,
      },
    });
  });

  it('returns AUTH_FAILED on a 401', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad key',
    }) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result.outcome === 'failed' && result.error.code).toBe('AUTH_FAILED');
  });

  it('returns a retryable PROVIDER_UNAVAILABLE when fetch throws', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result.outcome === 'failed' && result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(result.outcome === 'failed' && result.error.retryable).toBe(true);
  });

  it('returns UNPARSEABLE_RESPONSE when the model response is not parseable', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
    }) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result.outcome === 'failed' && result.error.code).toBe('UNPARSEABLE_RESPONSE');
  });

  it('never includes the API key in an error message', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'sk-test-key rejected',
    }) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result.outcome === 'failed' && result.error.message).not.toContain('sk-test-key');
  });
});
