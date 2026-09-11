import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

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
  it('maps ValidationException to an invalid model id', () => {
    const error = mapBedrockError({ name: 'ValidationException', message: 'bad model' });
    expect(error.code).toBe('INVALID_MODEL_ID');
    expect(error.retryable).toBe(false);
  });

  it('maps ResourceNotFoundException to an invalid model id', () => {
    expect(mapBedrockError({ name: 'ResourceNotFoundException' }).code).toBe('INVALID_MODEL_ID');
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
  it('resolves null when the probe succeeds', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    jest.spyOn((provider as any).client, 'send').mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({ content: [{ text: 'ok' }] })),
    });
    await expect(provider.validateConfig()).resolves.toBeNull();
  });

  it('resolves MODEL_ACCESS_DENIED when the account lacks model access', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    jest.spyOn((provider as any).client, 'send').mockRejectedValue({ name: 'AccessDeniedException' });
    const error = await provider.validateConfig();
    expect(error?.code).toBe('MODEL_ACCESS_DENIED');
  });

  it('sends a single-token probe for the configured model rather than a full classification', async () => {
    const provider = new BedrockClassificationProvider('a-model');
    const sendSpy = jest.spyOn((provider as any).client, 'send').mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({ content: [{ text: 'ok' }] })),
    });

    await provider.validateConfig();

    const command = sendSpy.mock.calls[0][0] as InvokeModelCommand;
    expect(command.input.modelId).toBe('a-model');
    const body = JSON.parse(new TextDecoder().decode(command.input.body as Uint8Array));
    expect(body.max_tokens).toBe(1);
  });
});
