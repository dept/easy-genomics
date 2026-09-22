import {
  isBelowRunFolderRoot,
  isRunFolderName,
  isSampleSheetKey,
  isWithinRunFolder,
  lastPathSegment,
  normalizeS3Prefix,
  parseS3ObjectUri,
  parseS3Uri,
} from '../../../src/app/utils/s3-uri-utils';

const laboratory = { OrganizationId: 'org-1', LaboratoryId: 'lab-1' };
const RUN_ID = '11111111-2222-4333-8444-555555555555';
const runFolder = `org-1/lab-1/aws-healthomics/${RUN_ID}/`;

describe('parseS3Uri', () => {
  it('splits a bucket and key', () => {
    expect(parseS3Uri('s3://my-bucket/org-1/lab-1/results/out.bam')).toEqual({
      bucket: 'my-bucket',
      prefix: 'org-1/lab-1/results/out.bam',
    });
  });

  it('returns null for values that are not s3 URIs', () => {
    expect(parseS3Uri('https://example.com/x')).toBeNull();
    expect(parseS3Uri('')).toBeNull();
    expect(parseS3Uri(undefined)).toBeNull();
    expect(parseS3Uri('s3:///no-bucket/key')).toBeNull();
  });

  it('allows a bucket with no key', () => {
    expect(parseS3Uri('s3://my-bucket')).toEqual({ bucket: 'my-bucket', prefix: '' });
    expect(parseS3Uri('s3://my-bucket/')).toEqual({ bucket: 'my-bucket', prefix: '' });
  });

  it('keeps a # in the key instead of treating it as a URL fragment', () => {
    // Generated sample sheet names permit '#', and a URL parse would truncate the key here,
    // leaving the real object undeleted while the sweep reports success.
    expect(parseS3Uri(`s3://my-bucket/${runFolder}samplesheet-Run-#5.csv`)?.prefix).toBe(
      `${runFolder}samplesheet-Run-#5.csv`,
    );
  });

  it('keeps a bare % in the key instead of failing to decode it', () => {
    expect(parseS3Uri(`s3://my-bucket/${runFolder}samplesheet-100%-done.csv`)?.prefix).toBe(
      `${runFolder}samplesheet-100%-done.csv`,
    );
  });

  it('does not percent-decode, so an escape sequence in the key survives verbatim', () => {
    expect(parseS3Uri(`s3://my-bucket/${runFolder}a%20b.csv`)?.prefix).toBe(`${runFolder}a%20b.csv`);
  });

  it('preserves spaces and other literal characters', () => {
    expect(parseS3Uri(`s3://my-bucket/${runFolder}samplesheet-my run.csv`)?.prefix).toBe(
      `${runFolder}samplesheet-my run.csv`,
    );
  });
});

describe('parseS3ObjectUri', () => {
  it('requires a non-empty key', () => {
    expect(parseS3ObjectUri('s3://my-bucket')).toBeNull();
    expect(parseS3ObjectUri('s3://my-bucket/')).toBeNull();
    expect(parseS3ObjectUri('s3://my-bucket/a.csv')).toEqual({ bucket: 'my-bucket', prefix: 'a.csv' });
  });
});

describe('normalizeS3Prefix', () => {
  it('appends a trailing slash only when missing', () => {
    expect(normalizeS3Prefix('a/b')).toBe('a/b/');
    expect(normalizeS3Prefix('a/b/')).toBe('a/b/');
  });
});

describe('isWithinRunFolder', () => {
  it('accepts keys under the lab prefix that carry the run id as a path segment', () => {
    expect(isWithinRunFolder(`${runFolder}samplesheet.csv`, laboratory, RUN_ID)).toBe(true);
    expect(isWithinRunFolder(`${runFolder}results/out.bam`, laboratory, RUN_ID)).toBe(true);
  });

  it('rejects keys belonging to another lab, another run, or no run', () => {
    expect(isWithinRunFolder(`org-2/lab-9/aws-healthomics/${RUN_ID}/x`, laboratory, RUN_ID)).toBe(false);
    expect(isWithinRunFolder('org-1/lab-1/aws-healthomics/other-run/x', laboratory, RUN_ID)).toBe(false);
    expect(isWithinRunFolder(`${runFolder}x`, laboratory, '')).toBe(false);
  });
});

describe('isBelowRunFolderRoot', () => {
  it('accepts a subdirectory of the run folder', () => {
    expect(isBelowRunFolderRoot(`${runFolder}results/`, laboratory, RUN_ID)).toBe(true);
    expect(isBelowRunFolderRoot(`${runFolder}custom-outdir/nested/`, laboratory, RUN_ID)).toBe(true);
  });

  it('rejects the run folder root, where the run input files live', () => {
    expect(isBelowRunFolderRoot(runFolder, laboratory, RUN_ID)).toBe(false);
    expect(isBelowRunFolderRoot(`${runFolder}//`, laboratory, RUN_ID)).toBe(false);
  });

  it('rejects anything already outside the run folder', () => {
    expect(isBelowRunFolderRoot('org-1/lab-1/', laboratory, RUN_ID)).toBe(false);
    expect(isBelowRunFolderRoot(`org-2/lab-9/aws-healthomics/${RUN_ID}/results/`, laboratory, RUN_ID)).toBe(false);
  });
});

describe('lastPathSegment', () => {
  it('returns the final segment, ignoring trailing slashes', () => {
    expect(lastPathSegment(runFolder)).toBe(RUN_ID);
    expect(lastPathSegment('a/b/c')).toBe('c');
    expect(lastPathSegment('a')).toBe('a');
  });
});

describe('isRunFolderName', () => {
  it('matches UUID folder names only', () => {
    expect(isRunFolderName(RUN_ID)).toBe(true);
    expect(isRunFolderName('results')).toBe(false);
    expect(isRunFolderName('aws-healthomics')).toBe(false);
  });
});

describe('isSampleSheetKey', () => {
  it('matches generated sample sheets at the run folder root', () => {
    expect(isSampleSheetKey(`${runFolder}samplesheet.csv`, runFolder)).toBe(true);
    expect(isSampleSheetKey(`${runFolder}samplesheet-my-run.csv`, runFolder)).toBe(true);
  });

  it('does not match sheets in a subfolder or unrelated files', () => {
    expect(isSampleSheetKey(`${runFolder}results/samplesheet.csv`, runFolder)).toBe(false);
    expect(isSampleSheetKey(`${runFolder}reads_R1.fq.gz`, runFolder)).toBe(false);
    expect(isSampleSheetKey('other/samplesheet.csv', runFolder)).toBe(false);
  });
});
