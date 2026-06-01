import { AMBIGUOUS_FALLBACK } from '../../../../src/app/services/llm-classification/bedrock-classification-provider';
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

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends Bearer auth header + json_object response_format', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => goodResponseBody,
    } as any);

    const provider = new OpenAIClassificationProvider('gpt-4o-mini', 'sk-test-key');
    await provider.classify({ platform: 'Seqera Cloud', errorMessage: 'boom' });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('parses a well-formed completion and returns the classification', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => goodResponseBody,
    } as any);

    const result = await new OpenAIClassificationProvider('gpt-4o-mini', 'sk').classify({
      platform: 'Seqera Cloud',
      errorMessage: 'boom',
    });

    expect(result.owner).toBe('Lab');
    expect(result.summary).toBe('Sample sheet invalid');
  });

  it('returns the ambiguous fallback on non-2xx', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as any);

    const result = await new OpenAIClassificationProvider('gpt-4o-mini', 'sk').classify({
      platform: 'Seqera Cloud',
      errorMessage: 'boom',
    });

    expect(result).toEqual(AMBIGUOUS_FALLBACK);
  });

  it('returns the ambiguous fallback when fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    const result = await new OpenAIClassificationProvider('gpt-4o-mini', 'sk').classify({
      platform: 'Seqera Cloud',
      errorMessage: 'boom',
    });

    expect(result).toEqual(AMBIGUOUS_FALLBACK);
  });

  it('returns the ambiguous fallback when the model response is not parseable', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'no json here' } }] }),
    } as any);

    const result = await new OpenAIClassificationProvider('gpt-4o-mini', 'sk').classify({
      platform: 'Seqera Cloud',
      errorMessage: 'boom',
    });

    expect(result).toEqual(AMBIGUOUS_FALLBACK);
  });
});
