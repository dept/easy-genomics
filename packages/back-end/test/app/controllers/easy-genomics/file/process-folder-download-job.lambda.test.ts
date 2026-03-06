import { SQSEvent } from 'aws-lambda';

const mockArchive = {
  pipe: jest.fn(),
  on: jest.fn(),
  append: jest.fn(),
  finalize: jest.fn(),
};

jest.mock('archiver', () => ({
  __esModule: true,
  default: jest.fn(() => mockArchive),
}));

jest.mock('../../../../../src/app/services/s3-service');

import { handler } from '../../../../../src/app/controllers/easy-genomics/file/process-folder-download-job.lambda';
import { S3Service } from '../../../../../src/app/services/s3-service';

describe('process-folder-download-job Lambda', () => {
  let mockListBucketObjectsV2: jest.Mock;
  let mockGetObject: jest.Mock;
  let mockPutObject: jest.Mock;
  let mockCreateMultipartUpload: jest.Mock;
  let mockUploadPart: jest.Mock;
  let mockCompleteMultipartUpload: jest.Mock;
  let mockAbortMultipartUpload: jest.Mock;
  let pipedZipStream: NodeJS.WritableStream | undefined;

  const createSnsWrappedSqsEvent = (message: Record<string, unknown>): SQSEvent =>
    ({
      Records: [
        {
          body: JSON.stringify({
            Message: JSON.stringify(message),
          }),
        },
      ],
    }) as SQSEvent;

  const baseJobMessage = {
    JobId: '61c86013-74f2-4d30-916a-70b03a97ba14',
    LaboratoryId: 'test-lab-id',
    OrganizationId: 'test-org-id',
    S3Bucket: 'test-bucket',
    RequestedPrefix: 'test-org-id/test-lab-id/results/',
    ArchiveKey: 'test-org-id/test-lab-id/.downloads/archives/archive.zip',
    StatusKey: 'test-org-id/test-lab-id/.downloads/jobs/status.json',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    pipedZipStream = undefined;
    mockArchive.pipe.mockImplementation((stream: NodeJS.WritableStream) => {
      pipedZipStream = stream;
      return undefined;
    });
    mockArchive.on.mockImplementation(() => mockArchive);
    mockArchive.append.mockImplementation(() => {
      if (pipedZipStream) {
        (pipedZipStream as any).write(Buffer.from('chunk-data'));
      }
      return undefined;
    });
    mockArchive.finalize.mockImplementation(async () => {
      if (pipedZipStream) {
        (pipedZipStream as any).end();
      }
      return undefined;
    });

    const mockS3ServiceInstance = S3Service as jest.MockedClass<typeof S3Service>;
    mockListBucketObjectsV2 = jest.fn();
    mockGetObject = jest.fn();
    mockPutObject = jest.fn();
    mockCreateMultipartUpload = jest.fn();
    mockUploadPart = jest.fn();
    mockCompleteMultipartUpload = jest.fn();
    mockAbortMultipartUpload = jest.fn();

    mockS3ServiceInstance.prototype.listBucketObjectsV2 = mockListBucketObjectsV2;
    mockS3ServiceInstance.prototype.getObject = mockGetObject;
    mockS3ServiceInstance.prototype.putObject = mockPutObject;
    mockS3ServiceInstance.prototype.createMultipartUpload = mockCreateMultipartUpload;
    mockS3ServiceInstance.prototype.uploadPart = mockUploadPart;
    mockS3ServiceInstance.prototype.completeMultipartUpload = mockCompleteMultipartUpload;
    mockS3ServiceInstance.prototype.abortMultipartUpload = mockAbortMultipartUpload;
  });

  it('processes paginated folders (>1000 objects) and completes', async () => {
    mockPutObject
      // write PROCESSING status
      .mockResolvedValueOnce({})
      // write COMPLETED status
      .mockResolvedValueOnce({});
    mockCreateMultipartUpload.mockResolvedValue({ UploadId: 'upload-id' });
    mockUploadPart.mockResolvedValue({ ETag: 'etag-part-1' });
    mockCompleteMultipartUpload.mockResolvedValue({});

    mockListBucketObjectsV2
      .mockResolvedValueOnce({
        Contents: [{ Key: 'test-org-id/test-lab-id/results/a.txt' }],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'test-org-id/test-lab-id/results/b.txt' }],
        IsTruncated: false,
      });

    mockGetObject.mockResolvedValue({
      Body: {} as NodeJS.ReadableStream,
    });

    const result = await handler(createSnsWrappedSqsEvent(baseJobMessage), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    expect(mockListBucketObjectsV2).toHaveBeenCalledTimes(2);
    expect(mockListBucketObjectsV2).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ContinuationToken: 'next-page',
      }),
    );
    expect(mockArchive.append).toHaveBeenCalledTimes(2);
    expect(mockArchive.append).toHaveBeenCalledWith(expect.anything(), { name: 'results/a.txt' });
    expect(mockArchive.append).toHaveBeenCalledWith(expect.anything(), { name: 'results/b.txt' });
    expect(mockCreateMultipartUpload).toHaveBeenCalled();
    expect(mockUploadPart).toHaveBeenCalled();
    expect(mockCompleteMultipartUpload).toHaveBeenCalled();

    const statusWrites = mockPutObject.mock.calls
      .map((call) => call[0])
      .filter((arg) => arg.ContentType === 'application/json');
    expect(statusWrites).toHaveLength(2);
    expect(JSON.parse(statusWrites[0].Body).Status).toBe('PROCESSING');
    expect(JSON.parse(statusWrites[1].Body).Status).toBe('COMPLETED');
  });

  it('marks job as FAILED when zipping throws', async () => {
    mockPutObject
      // write PROCESSING status
      .mockResolvedValueOnce({})
      // write FAILED status
      .mockResolvedValueOnce({});
    mockCreateMultipartUpload.mockResolvedValue({ UploadId: 'upload-id' });
    mockAbortMultipartUpload.mockResolvedValue({});

    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [{ Key: 'test-org-id/test-lab-id/results/a.txt' }],
      IsTruncated: false,
    });
    mockGetObject.mockRejectedValue(new Error('Could not read object'));

    const result = await handler(createSnsWrappedSqsEvent(baseJobMessage), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    const statusWrites = mockPutObject.mock.calls
      .map((call) => call[0])
      .filter((arg) => arg.ContentType === 'application/json');
    expect(statusWrites).toHaveLength(2);
    expect(JSON.parse(statusWrites[0].Body).Status).toBe('PROCESSING');
    expect(JSON.parse(statusWrites[1].Body).Status).toBe('FAILED');
  });

  it('marks job as FAILED when folder has no files', async () => {
    mockPutObject
      // write PROCESSING status
      .mockResolvedValueOnce({})
      // write FAILED status
      .mockResolvedValueOnce({});
    mockCreateMultipartUpload.mockResolvedValue({ UploadId: 'upload-id' });
    mockAbortMultipartUpload.mockResolvedValue({});

    mockListBucketObjectsV2.mockResolvedValue({
      Contents: [{ Key: 'test-org-id/test-lab-id/results/' }],
      IsTruncated: false,
    });

    const result = await handler(createSnsWrappedSqsEvent(baseJobMessage), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    const statusWrites = mockPutObject.mock.calls
      .map((call) => call[0])
      .filter((arg) => arg.ContentType === 'application/json');
    expect(statusWrites).toHaveLength(2);
    expect(JSON.parse(statusWrites[1].Body).Status).toBe('FAILED');
    expect(JSON.parse(statusWrites[1].Body).ErrorMessage).toContain('does not contain downloadable files');
  });
});
