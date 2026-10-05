import { SQSEvent } from 'aws-lambda';

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
jest.mock('../../../../../../src/app/services/s3-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/utils/laboratory-s3-access-utils', () => ({
  assertLaboratoryHasS3BucketAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service', () => ({
  LaboratoryDataTaggingService: jest.fn().mockImplementation(() => ({
    assertKeyUnderLabPrefix: (laboratory: { OrganizationId: string; LaboratoryId: string }, key: string) => {
      const root = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
      if (!key.startsWith(root)) {
        throw new Error(`S3 key is outside the laboratory prefix: ${key}`);
      }
    },
  })),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-run-export-job.lambda';
import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../../src/app/services/s3-service';
import { assertLaboratoryHasS3BucketAccess } from '../../../../../../src/app/utils/laboratory-s3-access-utils';

describe('process-run-export-job Lambda', () => {
  let mockListAllObjectsUnderPrefix: jest.Mock;
  let mockCopyObjectBySize: jest.Mock;
  let mockPutObject: jest.Mock;
  let mockGetObject: jest.Mock;
  let mockGetClient: jest.Mock;
  let pipedZipStream: NodeJS.WritableStream | undefined;

  const laboratory = {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'lab-bucket',
  };

  const completedRun = {
    LaboratoryId: 'lab-1',
    RunId: 'run-1',
    RunName: 'TB Panel',
    Status: 'COMPLETED',
    OutputS3Url: 's3://lab-bucket/org-1/lab-1/results/',
  };

  const baseJob = {
    JobId: '61c86013-74f2-4d30-916a-70b03a97ba14',
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    Destination: 'S3',
    Sources: [
      {
        RunId: 'run-1',
        RunName: 'spoofed',
        SourceBucket: 'attacker-bucket',
        SourcePrefix: '',
      },
    ],
    StatusBucket: 'lab-bucket',
    StatusKey: 'org-1/lab-1/.exports/jobs/job.json',
    DestBucket: 'lims-bucket',
    DestPrefix: 'org-1/lab-1/incoming/tb/',
  };

  const createSqsEvent = (message: Record<string, unknown>): SQSEvent =>
    ({
      Records: [{ body: JSON.stringify(message) }],
    }) as SQSEvent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadDone.mockResolvedValue(undefined);
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

    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue(laboratory);
    (LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>).prototype.queryByRunId = jest
      .fn()
      .mockResolvedValue(completedRun);

    mockListAllObjectsUnderPrefix = jest.fn().mockResolvedValue([
      { Key: 'org-1/lab-1/results/a.vcf', Size: 100 },
      { Key: 'org-1/lab-1/results/work/tmp.bin', Size: 50 },
    ]);
    mockCopyObjectBySize = jest.fn().mockResolvedValue(undefined);
    mockPutObject = jest.fn().mockResolvedValue({});
    mockGetObject = jest.fn().mockResolvedValue({ Body: {} as NodeJS.ReadableStream });
    mockGetClient = jest.fn().mockReturnValue({});

    const mockS3 = S3Service as jest.MockedClass<typeof S3Service>;
    mockS3.prototype.listAllObjectsUnderPrefix = mockListAllObjectsUnderPrefix;
    mockS3.prototype.copyObjectBySize = mockCopyObjectBySize;
    mockS3.prototype.putObject = mockPutObject;
    mockS3.prototype.getObject = mockGetObject;
    mockS3.prototype.getClient = mockGetClient;
  });

  it('re-resolves run outputs and copies under a per-run folder, skipping work/', async () => {
    const result = await handler(createSqsEvent(baseJob), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    expect(mockCopyObjectBySize).toHaveBeenCalledTimes(1);
    expect(mockCopyObjectBySize).toHaveBeenCalledWith({
      sourceBucket: 'lab-bucket',
      sourceKey: 'org-1/lab-1/results/a.vcf',
      destBucket: 'lims-bucket',
      destKey: 'org-1/lab-1/incoming/tb/TB_Panel-run-1/a.vcf',
      sizeBytes: 100,
    });
    expect(assertLaboratoryHasS3BucketAccess).toHaveBeenCalledWith(
      expect.objectContaining({ LaboratoryId: 'lab-1' }),
      'lims-bucket',
      expect.anything(),
    );
    const completedStatus = JSON.parse(mockPutObject.mock.calls.at(-1)[0].Body);
    expect(completedStatus.Status).toBe('COMPLETED');
    expect(completedStatus.FilesCopied).toBe(1);
  });

  it('writes FAILED status when the copy throws', async () => {
    mockCopyObjectBySize.mockRejectedValue(new Error('copy failed'));

    await handler(createSqsEvent(baseJob), {} as any, () => {});

    const failedStatus = JSON.parse(mockPutObject.mock.calls.at(-1)[0].Body);
    expect(failedStatus.Status).toBe('FAILED');
    expect(failedStatus.ErrorMessage).toBe('copy failed');
  });

  it('writes FAILED when the destination prefix is outside the laboratory path', async () => {
    await handler(createSqsEvent({ ...baseJob, DestPrefix: 'other-org/other-lab/incoming/' }), {} as any, () => {});

    expect(mockCopyObjectBySize).not.toHaveBeenCalled();
    const failedStatus = JSON.parse(mockPutObject.mock.calls.at(-1)[0].Body);
    expect(failedStatus.Status).toBe('FAILED');
    expect(failedStatus.ErrorMessage).toContain('outside the laboratory prefix');
  });

  it('zips exportable files for a Download job', async () => {
    const result = await handler(
      createSqsEvent({
        ...baseJob,
        Destination: 'Download',
        ArchiveKey: 'org-1/lab-1/.exports/archives/job.zip',
        DestBucket: undefined,
        DestPrefix: undefined,
      }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockGetObject).toHaveBeenCalledWith({
      Bucket: 'lab-bucket',
      Key: 'org-1/lab-1/results/a.vcf',
    });
    expect(mockArchive.append).toHaveBeenCalledWith(expect.anything(), {
      name: 'TB_Panel-run-1/a.vcf',
    });
    const completedStatus = JSON.parse(mockPutObject.mock.calls.at(-1)[0].Body);
    expect(completedStatus.Status).toBe('COMPLETED');
  });

  it('writes FAILED when ZIP getObject throws mid-loop', async () => {
    mockGetObject.mockRejectedValue(new Error('Could not read object'));

    await handler(
      createSqsEvent({
        ...baseJob,
        Destination: 'Download',
        ArchiveKey: 'org-1/lab-1/.exports/archives/job.zip',
        DestBucket: undefined,
        DestPrefix: undefined,
      }),
      {} as any,
      () => {},
    );

    const failedStatus = JSON.parse(mockPutObject.mock.calls.at(-1)[0].Body);
    expect(failedStatus.Status).toBe('FAILED');
    expect(failedStatus.ErrorMessage).toBe('Could not read object');
  });

  it('writes FAILED when the selected runs have no exportable files', async () => {
    mockListAllObjectsUnderPrefix.mockResolvedValue([{ Key: 'org-1/lab-1/results/work/tmp.bin', Size: 50 }]);

    await handler(createSqsEvent(baseJob), {} as any, () => {});

    expect(mockCopyObjectBySize).not.toHaveBeenCalled();
    const failedStatus = JSON.parse(mockPutObject.mock.calls.at(-1)[0].Body);
    expect(failedStatus.Status).toBe('FAILED');
  });
});
