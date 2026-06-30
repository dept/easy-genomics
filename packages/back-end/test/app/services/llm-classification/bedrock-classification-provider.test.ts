import { parseClassificationResponse } from '../../../../src/app/services/llm-classification/bedrock-classification-provider';

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
