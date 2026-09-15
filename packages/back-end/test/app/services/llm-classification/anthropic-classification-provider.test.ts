import { AnthropicClassificationProvider } from '../../../../src/app/services/llm-classification/anthropic-classification-provider';
import { AMBIGUOUS_FALLBACK } from '../../../../src/app/services/llm-classification/bedrock-classification-provider';

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

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends x-api-key and anthropic-version headers + Messages API body shape', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => goodResponseBody,
    } as any);

    const provider = new AnthropicClassificationProvider('claude-haiku-4-5-20251001', 'sk-ant-test');
    await provider.classify({ platform: 'AWS HealthOmics', failureReason: 'WORKFLOW_RUN_FAILED' });

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

    const result = await new AnthropicClassificationProvider('claude-haiku-4-5-20251001', 'sk-ant').classify({
      platform: 'AWS HealthOmics',
      failureReason: 'WORKFLOW_RUN_FAILED',
    });

    expect(result.owner).toBe('Bioinformatician');
    expect(result.summary).toBe('Container image too large');
  });

  it('returns the ambiguous fallback on non-2xx', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as any);

    const result = await new AnthropicClassificationProvider('claude-haiku-4-5-20251001', 'bad-key').classify({
      platform: 'AWS HealthOmics',
      failureReason: 'WORKFLOW_RUN_FAILED',
    });

    expect(result).toEqual(AMBIGUOUS_FALLBACK);
  });

  it('returns the ambiguous fallback when fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    const result = await new AnthropicClassificationProvider('claude-haiku-4-5-20251001', 'sk-ant').classify({
      platform: 'AWS HealthOmics',
      failureReason: 'WORKFLOW_RUN_FAILED',
    });

    expect(result).toEqual(AMBIGUOUS_FALLBACK);
  });
});
