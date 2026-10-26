import {
  allowedPrefixError,
  allowedPrefixesFromAssignments,
  changedAllowedPrefixKeys,
  changedWholeBucketKeys,
  normalizeAllowedPrefixInput,
  s3AccessKey,
  wholeBucketKeysFromAssignments,
  withAllowedPrefixChanges,
} from '../../../src/app/utils/s3-access-allowed-prefixes';

const keyA = s3AccessKey('lab-1', 'bucket-a');
const keyB = s3AccessKey('lab-1', 'bucket-b');

describe('allowedPrefixesFromAssignments', () => {
  it('keys stored prefixes by cell and ignores DENY rows and rows without one', () => {
    expect(
      allowedPrefixesFromAssignments([
        {
          LaboratoryId: 'lab-1',
          BucketName: 'bucket-a',
          OrganizationId: 'org-1',
          Effect: 'ALLOW',
          AllowedPrefix: 'sample-3-18/',
        },
        { LaboratoryId: 'lab-1', BucketName: 'bucket-b', OrganizationId: 'org-1', Effect: 'DENY', AllowedPrefix: 'x/' },
        { LaboratoryId: 'lab-1', BucketName: 'bucket-c', OrganizationId: 'org-1', Effect: 'ALLOW' },
      ]),
    ).toEqual({ [keyA]: 'sample-3-18/' });
  });
});

describe('normalizeAllowedPrefixInput', () => {
  it('trims and adds the trailing slash; blank stays blank', () => {
    expect(normalizeAllowedPrefixInput(' sample-3-18 ')).toBe('sample-3-18/');
    expect(normalizeAllowedPrefixInput('sample-3-18/')).toBe('sample-3-18/');
    expect(normalizeAllowedPrefixInput('   ')).toBe('');
  });
});

describe('allowedPrefixError', () => {
  it('accepts blank (no allowed folder) and a plain folder', () => {
    expect(allowedPrefixError('')).toBeNull();
    expect(allowedPrefixError('sample-3-18')).toBeNull();
  });

  it("explains why an organization's folder is rejected", () => {
    expect(allowedPrefixError('61c86013-74f2-4d30-916a-70b03a97ba14/lab/')).toBe(
      "Allowed folder must not be inside an organization's folder",
    );
  });
});

describe('changedAllowedPrefixKeys', () => {
  it('reports granted cells whose normalised prefix changed, and ignores revoked cells', () => {
    const granted = new Set([keyA]);
    expect(changedAllowedPrefixKeys(granted, { [keyA]: 'sample-3-18/' }, { [keyA]: 'sample-3-18' })).toEqual([]);
    expect(changedAllowedPrefixKeys(granted, { [keyA]: 'sample-3-18/' }, { [keyA]: '' })).toEqual([keyA]);
    expect(changedAllowedPrefixKeys(new Set(), {}, { [keyB]: 'x/' })).toEqual([]);
  });
});

describe('withAllowedPrefixChanges', () => {
  it('adds the pending prefix to a new grant', () => {
    const grants = [{ laboratoryId: 'lab-1', bucketName: 'bucket-a', granted: true }];
    expect(withAllowedPrefixChanges(grants, new Set([keyA]), {}, { [keyA]: 'sample-3-18' })).toEqual([
      { laboratoryId: 'lab-1', bucketName: 'bucket-a', granted: true, allowedPrefix: 'sample-3-18/' },
    ]);
  });

  it('re-sends an already-granted cell whose prefix alone changed', () => {
    expect(withAllowedPrefixChanges([], new Set([keyA]), {}, { [keyA]: 'sample-3-18/' })).toEqual([
      { laboratoryId: 'lab-1', bucketName: 'bucket-a', granted: true, allowedPrefix: 'sample-3-18/' },
    ]);
  });

  it('clears a prefix by re-sending the grant without one', () => {
    expect(withAllowedPrefixChanges([], new Set([keyA]), { [keyA]: 'sample-3-18/' }, { [keyA]: '' })).toEqual([
      { laboratoryId: 'lab-1', bucketName: 'bucket-a', granted: true },
    ]);
  });

  it('never attaches a prefix to a revoke', () => {
    const revokes = [{ laboratoryId: 'lab-1', bucketName: 'bucket-a', granted: false }];
    expect(
      withAllowedPrefixChanges(revokes, new Set(), { [keyA]: 'sample-3-18/' }, { [keyA]: 'sample-3-18/' }),
    ).toEqual(revokes);
  });
});

describe('whole-bucket access', () => {
  const row = { LaboratoryId: 'lab-1', BucketName: 'bucket-a', OrganizationId: 'org-1', Effect: 'ALLOW' as const };
  const grantA = { laboratoryId: 'lab-1', bucketName: 'bucket-a' };
  const ticked = (...keys: string[]) => ({ baseline: new Set<string>(), pending: new Set(keys) });

  it('reads stored whole-bucket grants as ticked cells, ignoring DENY rows and folder-only rows', () => {
    expect(
      wholeBucketKeysFromAssignments([
        { ...row, AllowsWholeBucket: true },
        { ...row, BucketName: 'bucket-b', Effect: 'DENY', AllowsWholeBucket: true },
        { ...row, BucketName: 'bucket-c', AllowedPrefix: 'x/' },
      ]),
    ).toEqual(new Set([keyA]));
  });

  it('reports granted cells whose tick changed, and ignores revoked cells', () => {
    expect(changedWholeBucketKeys(new Set([keyA]), new Set(), new Set([keyA, keyB]))).toEqual([keyA]);
  });

  it('sends a ticked cell as allowsWholeBucket with no allowedPrefix, whatever the folder input holds', () => {
    expect(
      withAllowedPrefixChanges(
        [{ ...grantA, granted: true }],
        new Set([keyA]),
        {},
        { [keyA]: 'sample-3-18/' },
        ticked(keyA),
      ),
    ).toEqual([{ ...grantA, granted: true, allowsWholeBucket: true }]);
  });

  it('re-sends an already-granted cell whose tick alone changed', () => {
    expect(withAllowedPrefixChanges([], new Set([keyA]), {}, {}, ticked(keyA))).toEqual([
      { ...grantA, granted: true, allowsWholeBucket: true },
    ]);
  });

  it('clears whole-bucket access by re-sending the grant without it', () => {
    const unticked = { baseline: new Set([keyA]), pending: new Set<string>() };
    expect(withAllowedPrefixChanges([], new Set([keyA]), {}, {}, unticked)).toEqual([{ ...grantA, granted: true }]);
  });

  it('never attaches whole-bucket access to a revoke', () => {
    const stillTicked = { baseline: new Set([keyA]), pending: new Set([keyA]) };
    expect(withAllowedPrefixChanges([{ ...grantA, granted: false }], new Set(), {}, {}, stillTicked)).toEqual([
      { ...grantA, granted: false },
    ]);
  });
});
