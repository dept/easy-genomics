import { AnthropicClassificationProvider } from '../../../../src/app/services/llm-classification/anthropic-classification-provider';
import { ClassificationInput } from '../../../../src/app/services/llm-classification/llm-classification-provider';

describe('AnthropicClassificationProvider', () => {
  const goodResponseBody = {
    content: [
      {
        text: JSON.stringify({
          owner: 'Bioinformatician',
          summary: 'Container image too large',
          action: 'Reduce the container size',
        }),
      },
    ],
  };

  let fetchSpy: jest.SpyInstance;
  let provider: AnthropicClassificationProvider;
  let input: ClassificationInput;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    provider = new AnthropicClassificationProvider('claude-haiku-4-5-20251001', 'sk-ant-test');
    input = { platform: 'AWS HealthOmics', failureReason: 'WORKFLOW_RUN_FAILED' };
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends x-api-key and anthropic-version headers + Messages API body shape', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => goodResponseBody,
    } as any);

    await provider.classify(input);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.system).toBeTruthy();
    expect(body.messages[0].role).toBe('user');
  });

  it('parses a well-formed Messages response and returns the classification', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => goodResponseBody,
    } as any);

    const result = await provider.classify(input);

    expect(result.outcome === 'classified' && result.result.owner).toBe('Bioinformatician');
    expect(result.outcome === 'classified' && result.result.summary).toBe('Container image too large');
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
        message: 'The anthropic API does not recognise the configured model ID.',
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

  it('treats a 529 overloaded response as retryable', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 529,
      text: async () => 'overloaded',
    }) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result.outcome === 'failed' && result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(result.outcome === 'failed' && result.error.retryable).toBe(true);
  });

  it('returns a retryable PROVIDER_UNAVAILABLE when fetch throws', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result.outcome === 'failed' && result.error.retryable).toBe(true);
  });

  it('returns UNPARSEABLE_RESPONSE when the model response is not parseable', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'not json at all' }] }),
    }) as unknown as typeof fetch;

    const result = await provider.classify(input);
    expect(result.outcome === 'failed' && result.error.code).toBe('UNPARSEABLE_RESPONSE');
  });
});

describe('AnthropicClassificationProvider.validateConfig', () => {
  it('resolves null when the probe returns 200', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    const provider = new AnthropicClassificationProvider('claude-x', 'sk-ant-test');
    await expect(provider.validateConfig()).resolves.toBeNull();
  });

  it('sends a single-token probe rather than a full classification', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await new AnthropicClassificationProvider('claude-x', 'sk-ant-test').validateConfig();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(1);
  });

  it('resolves AUTH_FAILED on a 401', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    const provider = new AnthropicClassificationProvider('claude-x', 'bad-key');
    expect((await provider.validateConfig())?.code).toBe('AUTH_FAILED');
  });
});
