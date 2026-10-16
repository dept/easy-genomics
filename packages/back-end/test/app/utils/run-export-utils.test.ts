import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  assertDestinationDoesNotOverlapSource,
  defaultBundleExportPrefix,
  defaultExportPrefix,
  destinationObjectKey,
  filterExportableRunObjects,
  isCompletedRunStatus,
  labScopedExportPrefix,
  listExportableRunObjects,
  resolveRunOutputLocation,
  sanitizeExportPrefix,
  shouldSkipRunExportKey,
} from '../../../src/app/utils/run-export-utils';

describe('run-export-utils', () => {
  describe('isCompletedRunStatus', () => {
    it('accepts SUCCEEDED and COMPLETED', () => {
      expect(isCompletedRunStatus('SUCCEEDED')).toBe(true);
      expect(isCompletedRunStatus('COMPLETED')).toBe(true);
    });

    it('rejects in-progress and failed statuses', () => {
      expect(isCompletedRunStatus('RUNNING')).toBe(false);
      expect(isCompletedRunStatus('FAILED')).toBe(false);
      expect(isCompletedRunStatus(undefined)).toBe(false);
    });
  });

  describe('resolveRunOutputLocation', () => {
    it('prefers OutputS3Url', () => {
      expect(
        resolveRunOutputLocation({
          OutputS3Url: 's3://lab-bucket/org/lab/results/',
          InputS3Url: 's3://lab-bucket/org/lab/input/',
        } as any),
      ).toEqual({
        bucket: 'lab-bucket',
        prefix: 'org/lab/results/',
        uri: 's3://lab-bucket/org/lab/results/',
      });
    });

    it('falls back to InputS3Url for legacy runs', () => {
      expect(resolveRunOutputLocation({ InputS3Url: 's3://lab-bucket/org/lab/run-1' } as any)).toEqual({
        bucket: 'lab-bucket',
        prefix: 'org/lab/run-1/',
        uri: 's3://lab-bucket/org/lab/run-1/',
      });
    });

    it('throws when no output location is stored', () => {
      expect(() => resolveRunOutputLocation({} as any)).toThrow(InvalidRequestError);
    });

    it('throws for a bucket-rooted URI with no key', () => {
      expect(() => resolveRunOutputLocation({ OutputS3Url: 's3://lab-bucket' } as any)).toThrow(InvalidRequestError);
    });
  });

  describe('shouldSkipRunExportKey', () => {
    const prefix = 'org/lab/run/';

    it('skips work scratch, download artifacts, and directory markers', () => {
      expect(shouldSkipRunExportKey(`${prefix}work/tmp.bam`, prefix)).toBe(true);
      expect(shouldSkipRunExportKey(`${prefix}.downloads/jobs/a.json`, prefix)).toBe(true);
      expect(shouldSkipRunExportKey(`${prefix}.exports/archives/x.zip`, prefix)).toBe(true);
      expect(shouldSkipRunExportKey(`${prefix}results/`, prefix)).toBe(true);
    });

    it('keeps published results', () => {
      expect(shouldSkipRunExportKey(`${prefix}results/report.html`, prefix)).toBe(false);
    });
  });

  describe('filterExportableRunObjects', () => {
    it('drops skipped keys and sums remaining files', () => {
      const exportable = filterExportableRunObjects(
        [
          { Key: 'org/lab/run/results/a.vcf', Size: 10 },
          { Key: 'org/lab/run/work/scratch.bin', Size: 999 },
          { Key: 'org/lab/run/results/', Size: 0 },
        ],
        'org/lab/run/',
      );
      expect(exportable).toEqual([{ Key: 'org/lab/run/results/a.vcf', Size: 10 }]);
    });
  });

  describe('listExportableRunObjects', () => {
    it('lists a run prefix and skips work/', async () => {
      const s3 = {
        listAllObjectsUnderPrefix: jest.fn().mockResolvedValue([
          { Key: 'org/lab/run/results/a.vcf', Size: 10 },
          { Key: 'org/lab/run/work/tmp.bin', Size: 99 },
        ]),
      };

      await expect(listExportableRunObjects({ s3, bucket: 'lab-bucket', runPrefix: 'org/lab/run/' })).resolves.toEqual([
        { Key: 'org/lab/run/results/a.vcf', Size: 10 },
      ]);
    });

    it('rejects an empty run prefix so the whole bucket is never listed', async () => {
      const s3 = { listAllObjectsUnderPrefix: jest.fn() };
      await expect(listExportableRunObjects({ s3, bucket: 'lab-bucket', runPrefix: '' })).rejects.toThrow(
        InvalidRequestError,
      );
      expect(s3.listAllObjectsUnderPrefix).not.toHaveBeenCalled();
    });
  });

  describe('sanitizeExportPrefix', () => {
    it('strips traversal and leading slashes', () => {
      expect(sanitizeExportPrefix('/incoming/../lims/run-1')).toBe('incoming/lims/run-1/');
    });

    it('rejects an empty prefix', () => {
      expect(() => sanitizeExportPrefix('..')).toThrow(InvalidRequestError);
    });
  });

  describe('defaultExportPrefix', () => {
    it('namespaces S3 and LIMS copies under a per-job folder', () => {
      const laboratory = { OrganizationId: 'org-1', LaboratoryId: 'lab-1' };
      expect(defaultExportPrefix({ laboratory, destination: 'S3', jobId: 'job-1' })).toBe('org-1/lab-1/exports/job-1/');
      expect(defaultExportPrefix({ laboratory, destination: 'Lims', jobId: 'job-1' })).toBe(
        'org-1/lab-1/lims-export/job-1/',
      );
    });
  });

  describe('defaultBundleExportPrefix', () => {
    it('namespaces a multi-run copy under a bundle folder', () => {
      expect(
        defaultBundleExportPrefix({
          laboratory: { OrganizationId: 'org-1', LaboratoryId: 'lab-1' },
          destination: 'S3',
          runCount: 3,
          jobId: 'job-1',
        }),
      ).toBe('org-1/lab-1/exports/bundle-3-runs-job-1/');
    });
  });

  describe('labScopedExportPrefix', () => {
    it('keeps a prefix already under the laboratory root', () => {
      expect(
        labScopedExportPrefix({ OrganizationId: 'org-1', LaboratoryId: 'lab-1' }, 'org-1/lab-1/custom/', 'fallback/'),
      ).toBe('org-1/lab-1/custom/');
    });

    it('nests a relative prefix under the laboratory root', () => {
      expect(
        labScopedExportPrefix({ OrganizationId: 'org-1', LaboratoryId: 'lab-1' }, 'incoming/tb/', 'fallback/'),
      ).toBe('org-1/lab-1/incoming/tb/');
    });
  });

  describe('assertDestinationDoesNotOverlapSource', () => {
    it('allows a different bucket', () => {
      expect(() =>
        assertDestinationDoesNotOverlapSource({
          sourceBucket: 'src',
          sourcePrefix: 'a/',
          destBucket: 'dest',
          destPrefix: 'a/',
        }),
      ).not.toThrow();
    });

    it('rejects overlapping prefixes on the same bucket', () => {
      expect(() =>
        assertDestinationDoesNotOverlapSource({
          sourceBucket: 'src',
          sourcePrefix: 'org/lab/run/',
          destBucket: 'src',
          destPrefix: 'org/lab/run/exports/',
        }),
      ).toThrow(InvalidRequestError);
    });

    it('rejects an empty source prefix on the same bucket', () => {
      expect(() =>
        assertDestinationDoesNotOverlapSource({
          sourceBucket: 'src',
          sourcePrefix: '',
          destBucket: 'src',
          destPrefix: 'org/lab/exports/',
        }),
      ).toThrow(InvalidRequestError);
    });
  });

  describe('destinationObjectKey', () => {
    it('preserves the relative path under the destination prefix', () => {
      expect(destinationObjectKey('org/lab/run/results/a.vcf', 'org/lab/run/', 'lims/incoming/')).toBe(
        'lims/incoming/results/a.vcf',
      );
    });
  });
});
