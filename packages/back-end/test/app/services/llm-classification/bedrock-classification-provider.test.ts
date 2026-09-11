import {
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
