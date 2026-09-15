process.env.NAME_PREFIX = 'unit-test';

import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

jest.mock('../../../../src/app/services/s3-service');

import { buildRunInputProfile } from '../../../../src/app/services/easy-genomics/run-input-profile-service';
import { S3Service } from '../../../../src/app/services/s3-service';

describe('buildRunInputProfile', () => {
  const lab = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    S3Bucket: 'lab-bucket',
  } as Laboratory;

  let mockGetObject: jest.Mock;
  let mockHeadObject: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetObject = jest.fn();
    mockHeadObject = jest.fn();
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.getObject = mockGetObject;
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.headObject = mockHeadObject;
  });

  it('rejects sampleSheetS3Url when bucket does not match laboratory.S3Bucket', async () => {
    const profile = await buildRunInputProfile({
      laboratory: lab,
      sampleSheetS3Url: 's3://other-bucket/org/lab/sheet.csv',
      settings: { a: 1 },
    });

    expect(mockGetObject).not.toHaveBeenCalled();
    expect(profile.SampleCount).toBe(0);
    expect(profile.ParameterHash).toBeTruthy();
  });

  it('reads sample sheet from the laboratory bucket', async () => {
    mockGetObject.mockResolvedValue({
      Body: 'sample,fastq_1\ns1,a.fq\ns2,b.fq\n',
    });

    const profile = await buildRunInputProfile({
      laboratory: lab,
      sampleSheetS3Url: 's3://lab-bucket/org/lab/sheet.csv',
    });

    expect(mockGetObject).toHaveBeenCalledWith({ Bucket: 'lab-bucket', Key: 'org/lab/sheet.csv' });
    expect(profile.SampleCount).toBe(2);
  });

  it('sums HeadObject sizes in parallel and tolerates per-key failures', async () => {
    mockHeadObject
      .mockResolvedValueOnce({ ContentLength: 100 })
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({ ContentLength: 50 });

    const profile = await buildRunInputProfile({
      laboratory: lab,
      inputFileKeys: ['a.fastq.gz', 'missing.bam', 'b.fastq.gz'],
    });

    expect(mockHeadObject).toHaveBeenCalledTimes(3);
    expect(profile.InputFileCount).toBe(3);
    expect(profile.InputBytesTotal).toBe(150);
    expect(profile.InputBytesByExtension?.['.fastq.gz']).toBe(150);
  });

  it('returns zeros when laboratory has no S3Bucket', async () => {
    const profile = await buildRunInputProfile({
      laboratory: { ...lab, S3Bucket: undefined } as Laboratory,
      sampleSheetS3Url: 's3://lab-bucket/sheet.csv',
      inputFileKeys: ['a.fq'],
    });

    expect(mockGetObject).not.toHaveBeenCalled();
    expect(mockHeadObject).not.toHaveBeenCalled();
    expect(profile.SampleCount).toBe(0);
    expect(profile.InputBytesTotal).toBe(0);
  });
});
