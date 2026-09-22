import { isWithinRunFolder, normalizeS3Prefix, parseS3Uri } from '../../../src/app/utils/s3-uri-utils';

const laboratory = { OrganizationId: 'org-1', LaboratoryId: 'lab-1' };

describe('parseS3Uri', () => {
  it('splits an s3 URI into bucket and key', () => {
    expect(parseS3Uri('s3://my-bucket/org-1/lab-1/run-1/results')).toEqual({
      bucket: 'my-bucket',
      prefix: 'org-1/lab-1/run-1/results',
    });
  });

  it('percent-decodes the key so names with spaces round-trip', () => {
    expect(parseS3Uri('s3://my-bucket/org-1/lab-1/run-1/my sheet.csv')?.prefix).toBe('org-1/lab-1/run-1/my sheet.csv');
  });

  it('returns null for undefined, empty, and non-s3 values rather than throwing', () => {
    expect(parseS3Uri(undefined)).toBeNull();
    expect(parseS3Uri('')).toBeNull();
    expect(parseS3Uri('https://example.com/x')).toBeNull();
  });
});

describe('normalizeS3Prefix', () => {
  it('appends a trailing slash only when missing', () => {
    expect(normalizeS3Prefix('a/b')).toBe('a/b/');
    expect(normalizeS3Prefix('a/b/')).toBe('a/b/');
  });
});

describe('isWithinRunFolder', () => {
  it('accepts keys inside the run folder', () => {
    expect(isWithinRunFolder('org-1/lab-1/aws-healthomics/run-1/results/', laboratory, 'run-1')).toBe(true);
    expect(isWithinRunFolder('org-1/lab-1/aws-healthomics/run-1/samplesheet.csv', laboratory, 'run-1')).toBe(true);
  });

  it('rejects keys outside the laboratory prefix', () => {
    expect(isWithinRunFolder('org-2/lab-9/aws-healthomics/run-1/results/', laboratory, 'run-1')).toBe(false);
  });

  it('rejects a lab-level location that does not name the run', () => {
    expect(isWithinRunFolder('org-1/lab-1/shared-results/', laboratory, 'run-1')).toBe(false);
  });

  it('rejects an empty run id so a blank id can never widen the match', () => {
    expect(isWithinRunFolder('org-1/lab-1/aws-healthomics/run-1/results/', laboratory, '')).toBe(false);
  });
});
