import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { S3Service } from '../../../src/app/services/s3-service';
import { sanitizeZipArchivePath, zipS3ObjectsToArchive } from '../../../src/app/utils/s3-zip-archive';

const mockArchive = {
  pipe: jest.fn(),
  on: jest.fn(),
  append: jest.fn(),
  finalize: jest.fn(),
};
const mockUploadDone = jest.fn();

jest.mock('archiver', () => ({
  __esModule: true,
  default: jest.fn(() => mockArchive),
}));
jest.mock('@aws-sdk/lib-storage', () => ({
  __esModule: true,
  Upload: jest.fn().mockImplementation(() => ({
    done: mockUploadDone,
  })),
}));

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

describe('zipS3ObjectsToArchive', () => {
  let s3: S3Service;
  let pipedZipStream: NodeJS.WritableStream | undefined;
  let archiveErrorHandler: ((err: unknown) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    pipedZipStream = undefined;
    archiveErrorHandler = undefined;
    mockUploadDone.mockResolvedValue(undefined);
    mockArchive.pipe.mockImplementation((stream: NodeJS.WritableStream) => {
      pipedZipStream = stream;
      return undefined;
    });
    mockArchive.on.mockImplementation((event: string, handler: (err: unknown) => void) => {
      if (event === 'error') archiveErrorHandler = handler;
      return mockArchive;
    });
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

    s3 = new S3Service();
    (s3 as unknown as { getObject: jest.Mock }).getObject = jest.fn().mockResolvedValue({ Body: {} });
    (s3 as unknown as { getClient: jest.Mock }).getClient = jest.fn().mockReturnValue({});
  });

  it('skips objects with no body', async () => {
    (s3 as unknown as { getObject: jest.Mock }).getObject = jest.fn().mockResolvedValue({});

    await zipS3ObjectsToArchive({
      s3,
      destinationBucket: 'lab-bucket',
      destinationKey: 'org-1/lab-1/.exports/archives/job.zip',
      entries: [{ sourceBucket: 'lab-bucket', sourceKey: 'a.vcf', archivePath: 'run/a.vcf' }],
    });

    expect(mockArchive.append).not.toHaveBeenCalled();
    expect(mockArchive.finalize).toHaveBeenCalled();
  });

  it('throws when the multipart upload rejects', async () => {
    mockUploadDone.mockRejectedValue(new Error('upload failed'));

    await expect(
      zipS3ObjectsToArchive({
        s3,
        destinationBucket: 'lab-bucket',
        destinationKey: 'org-1/lab-1/.exports/archives/job.zip',
        entries: [{ sourceBucket: 'lab-bucket', sourceKey: 'a.vcf', archivePath: 'run/a.vcf' }],
      }),
    ).rejects.toThrow('upload failed');
  });

  it('throws when archiver emits an error', async () => {
    mockArchive.append.mockImplementation(() => {
      archiveErrorHandler?.(new Error('archive exploded'));
      return undefined;
    });

    await expect(
      zipS3ObjectsToArchive({
        s3,
        destinationBucket: 'lab-bucket',
        destinationKey: 'org-1/lab-1/.exports/archives/job.zip',
        entries: [{ sourceBucket: 'lab-bucket', sourceKey: 'a.vcf', archivePath: 'run/a.vcf' }],
      }),
    ).rejects.toThrow('archive exploded');
  });
});
