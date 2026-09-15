import { shouldSeedAllowForLaboratory } from '../../../scripts/lib/migrate-laboratory-s3-access-seed-lib';

describe('shouldSeedAllowForLaboratory', () => {
  it('skips when configured bucket is missing or blank', () => {
    expect(shouldSeedAllowForLaboratory({ configuredBucket: undefined, existing: undefined })).toBe(false);
    expect(shouldSeedAllowForLaboratory({ configuredBucket: '  ', existing: undefined })).toBe(false);
  });

  it('seeds when there is no existing assignment', () => {
    expect(shouldSeedAllowForLaboratory({ configuredBucket: 'bucket-a', existing: undefined })).toBe(true);
  });

  it('skips when an ALLOW (or legacy) assignment already exists', () => {
    expect(shouldSeedAllowForLaboratory({ configuredBucket: 'bucket-a', existing: {} })).toBe(false);
    expect(shouldSeedAllowForLaboratory({ configuredBucket: 'bucket-a', existing: { Effect: 'ALLOW' } })).toBe(false);
  });

  it('seeds (overwrites) when an existing DENY is on the configured bucket', () => {
    expect(shouldSeedAllowForLaboratory({ configuredBucket: 'bucket-a', existing: { Effect: 'DENY' } })).toBe(true);
  });
});
