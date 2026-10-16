import { AllowedS3PrefixSchema, BatchUpdateLaboratoryS3AccessRequestSchema } from './laboratory-s3-access';

describe('AllowedS3PrefixSchema', () => {
  it.each(['sample-3-18/', 'sample-3-18', 'sequencing/runs/2026/', 'Partner Data/fastq/'])('accepts %p', (prefix) => {
    expect(AllowedS3PrefixSchema.safeParse(prefix).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['bucket root', '/'],
    ['leading slash', '/sample-3-18/'],
    ['parent segment', 'sample-3-18/../other/'],
    ['current segment', './sample-3-18/'],
    ['empty segment', 'sample-3-18//run-1/'],
    ['organization folder', '11111111-2222-4333-8444-555555555555/'],
    ['organization folder, upper case', '11111111-2222-4333-8444-55555555555A/anything/'],
    ['too long', `${'a'.repeat(512)}/`],
  ])('rejects %s', (_label, prefix) => {
    expect(AllowedS3PrefixSchema.safeParse(prefix).success).toBe(false);
  });
});

describe('BatchUpdateLaboratoryS3AccessRequestSchema', () => {
  const assignment = { laboratoryId: 'lab-1', bucketName: 'bucket-a', granted: true };

  it('accepts an assignment without allowedPrefix, as today', () => {
    expect(BatchUpdateLaboratoryS3AccessRequestSchema.safeParse({ assignments: [assignment] }).success).toBe(true);
  });

  it('accepts an assignment with a valid allowedPrefix', () => {
    const body = { assignments: [{ ...assignment, allowedPrefix: 'sample-3-18/' }] };
    expect(BatchUpdateLaboratoryS3AccessRequestSchema.safeParse(body).success).toBe(true);
  });

  it('rejects an assignment whose allowedPrefix points into an organization folder', () => {
    const body = { assignments: [{ ...assignment, allowedPrefix: '11111111-2222-4333-8444-555555555555/lab/' }] };
    expect(BatchUpdateLaboratoryS3AccessRequestSchema.safeParse(body).success).toBe(false);
  });
});
