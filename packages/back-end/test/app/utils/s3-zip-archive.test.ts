import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { sanitizeZipArchivePath } from '../../../src/app/utils/s3-zip-archive';

describe('sanitizeZipArchivePath', () => {
  it('flattens traversal segments', () => {
    expect(sanitizeZipArchivePath('TB_Panel-run-1/../../secret.txt')).toBe('TB_Panel-run-1/secret.txt');
  });

  it('strips leading slashes and empty segments', () => {
    expect(sanitizeZipArchivePath('/run-1//results/a.vcf')).toBe('run-1/results/a.vcf');
  });

  it('rejects a path that is only traversal', () => {
    expect(() => sanitizeZipArchivePath('../..')).toThrow(InvalidRequestError);
  });
});
