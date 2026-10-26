import { z } from 'zod';
import { validateApiResponse } from '../../../src/app/utils/api-utils';

const RunSchema = z
  .object({
    RunId: z.string(),
    Status: z.string(),
  })
  .strict();

describe('validateApiResponse', () => {
  it('accepts a payload that matches the schema', () => {
    expect(() => validateApiResponse(RunSchema, { RunId: 'run-1', Status: 'SUCCEEDED' })).not.toThrow();
  });

  it('ignores unrecognized keys so a newer backend does not blank the page', () => {
    expect(() =>
      validateApiResponse(RunSchema, {
        RunId: 'run-1',
        Status: 'SUCCEEDED',
        MicroreactStatus: 'Succeeded',
        MicroreactProjectUrl: 'https://microreact.org/project/abc',
      }),
    ).not.toThrow();
  });

  it('ignores unrecognized keys inside array items', () => {
    expect(() =>
      validateApiResponse(z.array(RunSchema), [
        { RunId: 'run-1', Status: 'SUCCEEDED', MicroreactStatus: 'Succeeded' },
        { RunId: 'run-2', Status: 'FAILED' },
      ]),
    ).not.toThrow();
  });

  it('still rejects a payload missing a required field', () => {
    expect(() => validateApiResponse(RunSchema, { RunId: 'run-1' })).toThrow(/Failed to validate API response/);
  });

  it('still rejects a payload with the wrong type for a known field', () => {
    expect(() => validateApiResponse(RunSchema, { RunId: 'run-1', Status: 1 })).toThrow(
      /Failed to validate API response/,
    );
  });
});
