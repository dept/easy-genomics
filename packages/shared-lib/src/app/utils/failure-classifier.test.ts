import { classifyHealthOmicsFailure, HEALTHOMICS_FAILURE_LOOKUP } from './failure-classifier';

describe('classifyHealthOmicsFailure', () => {
  it('returns null for undefined or empty failureReason', () => {
    expect(classifyHealthOmicsFailure(undefined)).toBeNull();
    expect(classifyHealthOmicsFailure(null)).toBeNull();
    expect(classifyHealthOmicsFailure('')).toBeNull();
  });

  it('returns null for ambiguous codes intentionally routed to the LLM', () => {
    expect(classifyHealthOmicsFailure('WORKFLOW_RUN_FAILED')).toBeNull();
    expect(classifyHealthOmicsFailure('RUN_TASK_FAILED')).toBeNull();
  });

  it('returns null for unknown codes', () => {
    expect(classifyHealthOmicsFailure('SOMETHING_WE_DO_NOT_KNOW_ABOUT')).toBeNull();
  });

  it('attributes the four canonical Bioinformatician codes to Bioinformatician', () => {
    for (const code of [
      'ECR_PERMISSION_ERROR',
      'OUT_OF_MEMORY_ERROR',
      'CANNOT_START_CONTAINER_SIZE_ERROR',
      'WORKFLOW_VER_VALIDATION_FAILED',
    ]) {
      const result = classifyHealthOmicsFailure(code);
      expect(result).not.toBeNull();
      expect(result!.owner).toBe('Bioinformatician');
      expect(result!.summary.length).toBeGreaterThan(0);
      expect(result!.action.length).toBeGreaterThan(0);
    }
  });

  it('attributes Lab-owned codes to Lab', () => {
    for (const code of ['IMPORT_FAILED', 'INPUT_URI_NOT_FOUND', 'MODIFIED_INPUT_RESOURCE', 'UNSUPPORTED_INPUT_SIZE']) {
      expect(classifyHealthOmicsFailure(code)?.owner).toBe('Lab');
    }
  });

  it('attributes transient AWS codes to AWS', () => {
    expect(classifyHealthOmicsFailure('INSTANCE_RESERVATION_FAILED')?.owner).toBe('AWS');
    expect(classifyHealthOmicsFailure('SERVICE_ERROR')?.owner).toBe('AWS');
  });

  it('attributes shared-ownership codes to Ambiguous so the UI shows a neutral badge', () => {
    expect(classifyHealthOmicsFailure('EXPORT_FAILED')?.owner).toBe('Ambiguous');
    expect(classifyHealthOmicsFailure('INVALID_URI_INPUT')?.owner).toBe('Ambiguous');
  });

  it('every entry in the lookup table has non-empty summary and action', () => {
    const entries = Object.entries(HEALTHOMICS_FAILURE_LOOKUP);
    expect(entries.length).toBeGreaterThanOrEqual(22);
    for (const [code, value] of entries) {
      expect(value.summary).toBeTruthy();
      expect(value.action).toBeTruthy();
      expect(['Lab', 'Bioinformatician', 'AWS', 'Ambiguous']).toContain(value.owner);
      // Sanity: the lookup must NOT contain the two LLM-only codes.
      expect(['WORKFLOW_RUN_FAILED', 'RUN_TASK_FAILED']).not.toContain(code);
    }
  });
});
