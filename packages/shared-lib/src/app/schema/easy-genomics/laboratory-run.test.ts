import { LaboratoryRunSchema } from './laboratory-run';

describe('LaboratoryRunSchema analysis fields', () => {
  // Every required LaboratoryRunSchema field, so a parse failure can only be
  // caused by the field under test.
  const base = {
    LaboratoryId: '11111111-1111-4111-8111-111111111111',
    RunId: '22222222-2222-4222-8222-222222222222',
    UserId: '33333333-3333-4333-8333-333333333333',
    OrganizationId: '44444444-4444-4444-8444-444444444444',
    RunName: 'test-run',
    Platform: 'AWS HealthOmics',
    Status: 'FAILED',
    Owner: 'tester@example.com',
  };

  it('accepts a run with no analysis fields at all', () => {
    expect(LaboratoryRunSchema.safeParse(base).success).toBe(true);
  });

  it('accepts every valid AnalysisStatus', () => {
    for (const status of ['Queued', 'Running', 'Succeeded', 'Failed']) {
      expect(LaboratoryRunSchema.safeParse({ ...base, AnalysisStatus: status }).success).toBe(true);
    }
  });

  it('rejects an unknown AnalysisStatus', () => {
    expect(LaboratoryRunSchema.safeParse({ ...base, AnalysisStatus: 'Pending' }).success).toBe(false);
  });

  it('accepts an error code and message together', () => {
    const parsed = LaboratoryRunSchema.safeParse({
      ...base,
      AnalysisStatus: 'Failed',
      AnalysisErrorCode: 'INVALID_MODEL_ID',
      AnalysisErrorMessage: 'The bedrock API does not recognise the configured model ID.',
      AnalysisRequestedAt: '2026-09-11T10:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });
});
