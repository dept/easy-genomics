import { SQSEvent } from 'aws-lambda';

jest.mock('../../../../../../src/app/services/s3-service');

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-run-export-job.lambda';
import { S3Service } from '../../../../../../src/app/services/s3-service';

describe('process-run-export-job Lambda', () => {
  let mockListAllObjectsUnderPrefix: jest.Mock;
  let mockCopyObjectBySize: jest.Mock;
  let mockPutObject: jest.Mock;

  const baseJob = {
    JobId: '61c86013-74f2-4d30-916a-70b03a97ba14',
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    Destination: 'S3',
    Sources: [
      {
        RunId: 'run-1',
        RunName: 'TB Panel',
        SourceBucket: 'lab-bucket',
        SourcePrefix: 'org-1/lab-1/results/',
      },
    ],
    StatusBucket: 'lab-bucket',
    StatusKey: 'org-1/lab-1/.exports/jobs/job.json',
    DestBucket: 'lims-bucket',
    DestPrefix: 'incoming/tb/',
  };

  const createSqsEvent = (message: Record<string, unknown>): SQSEvent =>
    ({
      Records: [{ body: JSON.stringify(message) }],
    }) as SQSEvent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockListAllObjectsUnderPrefix = jest.fn().mockResolvedValue([
      { Key: 'org-1/lab-1/results/a.vcf', Size: 100 },
      { Key: 'org-1/lab-1/results/work/tmp.bin', Size: 50 },
    ]);
    mockCopyObjectBySize = jest.fn().mockResolvedValue(undefined);
    mockPutObject = jest.fn().mockResolvedValue({});

    const mockS3 = S3Service as jest.MockedClass<typeof S3Service>;
    mockS3.prototype.listAllObjectsUnderPrefix = mockListAllObjectsUnderPrefix;
    mockS3.prototype.copyObjectBySize = mockCopyObjectBySize;
    mockS3.prototype.putObject = mockPutObject;
  });

  it('copies exportable files under a per-run folder and skips work/', async () => {
    const result = await handler(createSqsEvent(baseJob), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    expect(mockCopyObjectBySize).toHaveBeenCalledTimes(1);
    expect(mockCopyObjectBySize).toHaveBeenCalledWith({
      sourceBucket: 'lab-bucket',
      sourceKey: 'org-1/lab-1/results/a.vcf',
      destBucket: 'lims-bucket',
      destKey: 'incoming/tb/TB_Panel-run-1/a.vcf',
      sizeBytes: 100,
    });
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
});
