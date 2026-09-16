import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

import {
  BedrockClassificationProvider,
  mapBedrockError,
  parseClassificationResponse,
} from '../../../../src/app/services/llm-classification/bedrock-classification-provider';

describe('parseClassificationResponse', () => {
  it('returns null for empty text', () => {
    expect(parseClassificationResponse('')).toBeNull();
  });

  it('returns null when no JSON object can be located', () => {
    expect(parseClassificationResponse('Sorry, I cannot classify this.')).toBeNull();
  });

  it('returns null when JSON parse fails', () => {
    expect(parseClassificationResponse('{ owner: "Lab", summary: "broken json" }')).toBeNull();
  });

  it('returns null when owner is missing or invalid', () => {
    expect(parseClassificationResponse('{"summary":"x","action":"y"}')).toBeNull();
    expect(parseClassificationResponse('{"owner":"NotARealOwner","summary":"x","action":"y"}')).toBeNull();
  });

  it('returns null when summary or action is missing or empty', () => {
    expect(parseClassificationResponse('{"owner":"Lab","summary":"","action":"do x"}')).toBeNull();
    expect(parseClassificationResponse('{"owner":"Lab","summary":"x"}')).toBeNull();
  });

  it('parses a well-formed JSON object', () => {
    const result = parseClassificationResponse(
      '{"owner":"Lab","summary":"Sample sheet is invalid.","action":"Re-upload a valid sample sheet."}',
    );
    expect(result).toEqual({
      owner: 'Lab',
      summary: 'Sample sheet is invalid.',
      action: 'Re-upload a valid sample sheet.',
    });
  });

  it('extracts the JSON object even when the model wraps it in prose', () => {
    const result = parseClassificationResponse(
      'Here is my classification: {"owner":"AWS","summary":"Transient capacity error.","action":"Retry the run."} thanks!',
    );
    expect(result?.owner).toBe('AWS');
  });

  it('truncates summary and action to the documented limits', () => {
    const longSummary = 'a'.repeat(250);
    const longAction = 'b'.repeat(400);
    const result = parseClassificationResponse(
      JSON.stringify({ owner: 'Bioinformatician', summary: longSummary, action: longAction }),
    );
    expect(result!.summary.length).toBe(200);
    expect(result!.action.length).toBe(300);
  });
});

describe('mapBedrockError', () => {
  it('maps ValidationException to an invalid model id and keeps the Bedrock message', () => {
    const error = mapBedrockError({
      name: 'ValidationException',
      message: "Invocation of model ID anthropic.claude-sonnet-4-5 with on-demand throughput isn't supported.",
    });
    expect(error.code).toBe('INVALID_MODEL_ID');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("on-demand throughput isn't supported");
  });

  it('maps ResourceNotFoundException to a config error carrying the Bedrock message', () => {
    const error = mapBedrockError({
      name: 'ResourceNotFoundException',
      message: 'Model use case details have not been submitted for this account.',
    });
    expect(error.code).toBe('MODEL_ACCESS_DENIED');
    expect(error.message).toContain('use case details');
    expect(error.retryable).toBe(false);
  });

  it('tells the admin how to clear the one-time Anthropic use case form', () => {
    const error = mapBedrockError({
      name: 'ResourceNotFoundException',
      message:
        'Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model.',
    });
    expect(error.message).toContain('Bedrock console');
    expect(error.message).toContain('Amazon Nova');
  });

  it('tells the admin to use an inference profile when on-demand is unsupported', () => {
    const error = mapBedrockError({
      name: 'ValidationException',
      message:
        "Invocation of model ID anthropic.claude-sonnet-4-5-20250929-v1:0 with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile.",
    });
    expect(error.code).toBe('INVALID_MODEL_ID');
    expect(error.message).toContain('us.');
  });

  it('leaves an unrelated ValidationException without inference-profile advice', () => {
    const error = mapBedrockError({ name: 'ValidationException', message: 'malformed input' });
    expect(error.message).toContain('malformed input');
    expect(error.message).not.toContain('us.');
  });

  it('maps AccessDeniedException to denied model access', () => {
    const error = mapBedrockError({ name: 'AccessDeniedException' });
    expect(error.code).toBe('MODEL_ACCESS_DENIED');
    expect(error.message).toContain('model access');
  });

  it('maps ThrottlingException to a retryable rate limit', () => {
    const error = mapBedrockError({ name: 'ThrottlingException' });
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
  });

  it('maps ServiceUnavailableException to a retryable outage', () => {
    expect(mapBedrockError({ name: 'ServiceUnavailableException' }).retryable).toBe(true);
  });

  it('maps anything unrecognised to a non-retryable provider error', () => {
    const error = mapBedrockError(new Error('something else'));
    expect(error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(error.retryable).toBe(false);
  });
});

describe('BedrockClassificationProvider.validateConfig', () => {
  const converseReply = { output: { message: { content: [{ text: 'ok' }] } } };

  it('resolves null when the probe succeeds', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    jest.spyOn((provider as any).client, 'send').mockResolvedValue(converseReply);
    await expect(provider.validateConfig()).resolves.toBeNull();
  });

  it('resolves MODEL_ACCESS_DENIED when the account lacks model access', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    jest.spyOn((provider as any).client, 'send').mockRejectedValue({ name: 'AccessDeniedException' });
    const error = await provider.validateConfig();
    expect(error?.code).toBe('MODEL_ACCESS_DENIED');
  });

  it('logs the underlying Bedrock exception so a rejected save is diagnosable', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest
      .spyOn((provider as any).client, 'send')
      .mockRejectedValue({ name: 'ResourceNotFoundException', message: 'use case details' });

    await provider.validateConfig();

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('sends a single-token Converse probe for the configured model', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    const sendSpy = jest.spyOn((provider as any).client, 'send').mockResolvedValue(converseReply);

    await provider.validateConfig();

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.modelId).toBe('a-model');
    expect(command.input.inferenceConfig?.maxTokens).toBe(1);
  });
});

describe('BedrockClassificationProvider.classify', () => {
  const input = { platform: 'AWS HealthOmics', runName: 'r', status: 'FAILED', statusMessage: 'boom' } as any;

  it('sends a Converse request that carries no provider-specific body format', async () => {
    const provider = new BedrockClassificationProvider('us.amazon.nova-lite-v1:0');
    const sendSpy = jest.spyOn((provider as any).client, 'send').mockResolvedValue({
      output: {
        message: {
          content: [{ text: '{"owner":"Lab","summary":"Bad sample sheet.","action":"Re-upload it."}' }],
        },
      },
    });

    const outcome = await provider.classify(input);

    const command = sendSpy.mock.calls[0][0] as ConverseCommand;
    expect(command.input.modelId).toBe('us.amazon.nova-lite-v1:0');
    expect(command.input.messages?.[0]?.content?.[0]).toHaveProperty('text');
    expect(outcome.outcome).toBe('classified');
  });

  it('fails with UNPARSEABLE_RESPONSE when the model returns prose', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    jest.spyOn((provider as any).client, 'send').mockResolvedValue({
      output: { message: { content: [{ text: 'I cannot help with that.' }] } },
    });

    const outcome = await provider.classify(input);

    expect(outcome.outcome).toBe('failed');
    expect((outcome as any).error.code).toBe('UNPARSEABLE_RESPONSE');
  });
});
