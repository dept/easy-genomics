process.env.NAME_PREFIX = 'unit-test';

import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

jest.mock('../../../../src/app/services/s3-service');

import {
  buildRunInputProfile,
  readSampleSheet,
  sumObjectBytes,
} from '../../../../src/app/services/easy-genomics/run-input-profile-service';
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

describe('readSampleSheet', () => {
  const lab = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    S3Bucket: 'lab-bucket',
  } as Laboratory;

  let mockGetObject: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetObject = jest.fn();
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.getObject = mockGetObject;
  });

  it.each([undefined, ''])('reports no sample sheet for %p without reading S3', async (url) => {
    await expect(readSampleSheet(lab, url)).resolves.toEqual({ outcome: 'notRead', reason: 'noSampleSheet' });
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('refuses a sample sheet outside the laboratory bucket without reading S3', async () => {
    await expect(readSampleSheet(lab, 's3://other-bucket/x.csv')).resolves.toEqual({
      outcome: 'notRead',
      reason: 'notInLaboratoryBucket',
    });
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('reports an unparseable sample sheet URL as unreadable', async () => {
    await expect(readSampleSheet(lab, 'not-a-url')).resolves.toEqual({ outcome: 'notRead', reason: 'unreadable' });
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('reports a sample sheet S3 refuses to return as unreadable', async () => {
    mockGetObject.mockRejectedValue(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));

    await expect(readSampleSheet(lab, 's3://lab-bucket/sheet.csv')).resolves.toEqual({
      outcome: 'notRead',
      reason: 'unreadable',
    });
  });

  it('counts samples and keeps only deduplicated data files in the laboratory bucket', async () => {
    mockGetObject.mockResolvedValue({
      Body:
        'sample,fastq_1,fastq_2\n' +
        's1,s3://lab-bucket/a_R1.fq.gz,s3://lab-bucket/a_R2.fq.gz\n' +
        's2,s3://other/b.fq.gz,\n' +
        's3, s3://lab-bucket/a_R1.fq.gz ,\n',
    });

    await expect(readSampleSheet(lab, 's3://lab-bucket/sheet.csv')).resolves.toEqual({
      outcome: 'read',
      sampleCount: 3,
      dataFileKeys: ['a_R1.fq.gz', 'a_R2.fq.gz'],
    });
    expect(mockGetObject).toHaveBeenCalledWith({ Bucket: 'lab-bucket', Key: 'sheet.csv' });
  });

  it('reads a header-only sample sheet as zero samples', async () => {
    mockGetObject.mockResolvedValue({ Body: 'sample,fastq_1,fastq_2\n' });

    await expect(readSampleSheet(lab, 's3://lab-bucket/sheet.csv')).resolves.toEqual({
      outcome: 'read',
      sampleCount: 0,
      dataFileKeys: [],
    });
  });
});

describe('sumObjectBytes', () => {
  let mockHeadObject: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHeadObject = jest.fn();
    (S3Service as jest.MockedClass<typeof S3Service>).prototype.headObject = mockHeadObject;
  });

  it('is zero for no keys without calling S3', async () => {
    await expect(sumObjectBytes('lab-bucket', [])).resolves.toBe(0);
    expect(mockHeadObject).not.toHaveBeenCalled();
  });

  it('sums the sizes it can read and skips a failed head', async () => {
    mockHeadObject.mockResolvedValueOnce({ ContentLength: 120 }).mockRejectedValueOnce(new Error('missing'));

    await expect(sumObjectBytes('lab-bucket', ['a.fq.gz', 'b.fq.gz'])).resolves.toBe(120);
    expect(mockHeadObject).toHaveBeenCalledWith({ Bucket: 'lab-bucket', Key: 'a.fq.gz' });
  });
});
