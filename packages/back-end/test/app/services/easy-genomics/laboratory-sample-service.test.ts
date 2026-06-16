process.env.NAME_PREFIX = 'unit-test';

import { ConditionalCheckFailedException, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { S3BucketMismatchError, S3KeyOutOfPrefixError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { encodeS3ObjectRef } from '../../../../src/app/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratorySampleService } from '../../../../src/app/services/easy-genomics/laboratory-sample-service';

function labFixture(overrides?: Partial<Laboratory>): Laboratory {
  return {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'my-bucket',
    ...overrides,
  } as Laboratory;
}

describe('LaboratorySampleService.bulkCreateSamples', () => {
  let svc: LaboratorySampleService;
  let mockCopy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratorySampleService();
    mockCopy = jest.fn().mockResolvedValue(undefined);
    (svc as unknown as { s3Service: { copyBucketObject: typeof mockCopy } }).s3Service = {
      copyBucketObject: mockCopy,
    };
  });

  it('rejects copy jobs from a bucket that does not match the laboratory', async () => {
    const lab = labFixture();
    await expect(
      svc.bulkCreateSamples(lab, 'user-1', 'my-bucket', {
        importLabel: 'import',
        samples: [],
        copyJobs: [{ sourceBucket: 'evil-bucket', sourceKey: 'org-1/lab-1/a.fq.gz', destKey: 'org-1/lab-1/b.fq.gz' }],
      }),
    ).rejects.toThrow(S3BucketMismatchError);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('rejects copy jobs whose source key is outside the laboratory prefix', async () => {
    const lab = labFixture();
    await expect(
      svc.bulkCreateSamples(lab, 'user-1', 'my-bucket', {
        importLabel: 'import',
        samples: [],
        copyJobs: [{ sourceBucket: 'my-bucket', sourceKey: 'other/a.fq.gz', destKey: 'org-1/lab-1/b.fq.gz' }],
      }),
    ).rejects.toThrow(S3KeyOutOfPrefixError);
    expect(mockCopy).not.toHaveBeenCalled();
  });
});

describe('LaboratorySampleService.generateSequenceCollectionSampleSheet', () => {
  let svc: LaboratorySampleService;
  let mockGetItem: jest.Mock;
  let mockQueryItems: jest.Mock;
  let mockPutObject: jest.Mock;
  let mockUpdateItem: jest.Mock;
  let mockDoesObjectExist: jest.Mock;
  let listSampleFilesSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratorySampleService();
    mockGetItem = jest.fn();
    mockQueryItems = jest.fn();
    mockPutObject = jest.fn().mockResolvedValue(undefined);
    mockUpdateItem = jest.fn().mockResolvedValue(undefined);
    mockDoesObjectExist = jest.fn().mockResolvedValue(true);
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
    (
      svc as unknown as { s3Service: { putObject: typeof mockPutObject; doesObjectExist: typeof mockDoesObjectExist } }
    ).s3Service = {
      putObject: mockPutObject,
      doesObjectExist: mockDoesObjectExist,
    };
    (svc as unknown as { taggingService: Record<string, jest.Mock> }).taggingService = {
      getKindIndexedTagIds: jest.fn().mockResolvedValue({
        batchTagIds: new Set<string>(),
        workflowTagIds: new Set<string>(),
        permanentTagIds: new Set<string>(),
      }),
      assertBucketMatchesLab: jest.fn(),
    };

    listSampleFilesSpy = jest.spyOn(svc, 'listSampleFiles');
  });

  it('paginates sample files when building the sample sheet', async () => {
    const lab = labFixture();
    const collectionId = 'dc-1';
    const setId = 'set-1';

    mockGetItem.mockImplementation(async (input: { Key?: Record<string, AttributeValue> }) => {
      const key = input.Key ? unmarshall(input.Key) : {};
      if (key.Sk === `SEQUENCE_COLLECTION#${collectionId}`) {
        return {
          Item: marshall({
            LaboratoryId: 'lab-1',
            Sk: `SEQUENCE_COLLECTION#${collectionId}`,
            SequenceCollectionId: collectionId,
            Name: 'Run collection',
            Columns: [
              { columnName: 'sample', role: 'sample_id', required: true },
              { columnName: 'fastq_1', role: 'read1', required: true },
            ],
          }),
        };
      }
      if (key.Sk === `SAMPLE#${setId}`) {
        return {
          Item: marshall({
            LaboratoryId: 'lab-1',
            Sk: `SAMPLE#${setId}`,
            SampleId: setId,
            Name: 'SampleA',
            Layout: 'single_end',
          }),
        };
      }
      return {};
    });

    mockQueryItems.mockResolvedValue({
      Items: [marshall({ SampleId: setId, Gsi1Pk: 'lab-1#SC#dc-1' })],
    });

    const page1Files = Array.from({ length: 500 }, (_, i) => ({
      Bucket: 'my-bucket',
      Key: `org-1/lab-1/sample_${i}.fastq.gz`,
    }));
    const page2Files = [{ Bucket: 'my-bucket', Key: 'org-1/lab-1/sample_extra.fastq.gz' }];

    listSampleFilesSpy
      .mockResolvedValueOnce({ Files: page1Files, NextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ Files: page2Files });

    const result = await svc.generateSequenceCollectionSampleSheet(lab, 'my-bucket', collectionId, {
      platform: 'AWS HealthOmics',
      transactionId: 'txn-1',
      sampleSheetName: 'sheet.csv',
    });

    expect(listSampleFilesSpy).toHaveBeenCalledTimes(2);
    expect(result.InputFileKeys).toHaveLength(501);
    expect(result.InputFileKeys).toContain('org-1/lab-1/sample_extra.fastq.gz');
  });
});

describe('LaboratorySampleService.addSampleIdToFileRow', () => {
  let svc: LaboratorySampleService;
  let mockUpdateItem: jest.Mock;
  let mockPutItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratorySampleService();
    mockUpdateItem = jest.fn().mockResolvedValue({});
    mockPutItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
    (svc as unknown as { putItem: typeof mockPutItem }).putItem = mockPutItem;
  });

  it('returns quietly when the sample id is already on the file row', async () => {
    mockUpdateItem.mockRejectedValueOnce(new ConditionalCheckFailedException({ message: 'c', $metadata: {} }));
    await (svc as unknown as { addSampleIdToFileRow: (...args: unknown[]) => Promise<void> }).addSampleIdToFileRow(
      'lab-1',
      encodeS3ObjectRef('my-bucket', 'org-1/lab-1/a.fq.gz'),
      'my-bucket',
      'org-1/lab-1/a.fq.gz',
      'set-1',
      'user-1',
    );
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('re-throws non-conditional DynamoDB errors instead of overwriting the file row', async () => {
    mockUpdateItem.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));
    await expect(
      (svc as unknown as { addSampleIdToFileRow: (...args: unknown[]) => Promise<void> }).addSampleIdToFileRow(
        'lab-1',
        encodeS3ObjectRef('my-bucket', 'org-1/lab-1/a.fq.gz'),
        'my-bucket',
        'org-1/lab-1/a.fq.gz',
        'set-1',
        'user-1',
      ),
    ).rejects.toThrow('ProvisionedThroughputExceededException');
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});

describe('LaboratorySampleService.adjustSequenceCollectionSampleCount', () => {
  let svc: LaboratorySampleService;
  let mockGetItem: jest.Mock;
  let mockUpdateItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratorySampleService();
    mockGetItem = jest.fn().mockResolvedValue({
      Item: marshall({
        LaboratoryId: 'lab-1',
        Sk: 'SEQUENCE_COLLECTION#dc-1',
        SequenceCollectionId: 'dc-1',
        SampleCount: 3,
      }),
    });
    mockUpdateItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
  });

  it('updates sequence collection sample count', async () => {
    await (
      svc as unknown as { adjustSequenceCollectionSampleCount: (...args: unknown[]) => Promise<void> }
    ).adjustSequenceCollectionSampleCount('lab-1', 'dc-1', 2, 'user-1');

    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        UpdateExpression: 'SET SampleCount = :n, ModifiedAt = :ma, ModifiedBy = :mb',
      }),
    );
  });
});

describe('LaboratorySampleService.listUnlinkedBucketObjects', () => {
  let svc: LaboratorySampleService;
  let mockListTransactionInputs: jest.Mock;
  let mockGetSampleIdsForFileRefs: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratorySampleService();
    mockListTransactionInputs = jest.fn().mockResolvedValue({
      contents: [{ Key: 'org-1/lab-1/unlinked.fq.gz' }, { Key: 'org-1/lab-1/linked.fq.gz' }],
      listingTruncated: false,
    });
    mockGetSampleIdsForFileRefs = jest.fn().mockResolvedValue(
      new Map([
        [encodeS3ObjectRef('my-bucket', 'org-1/lab-1/unlinked.fq.gz'), []],
        [encodeS3ObjectRef('my-bucket', 'org-1/lab-1/linked.fq.gz'), ['set-1']],
      ]),
    );
    (
      svc as unknown as { dataCollectionService: { listTransactionInputs: typeof mockListTransactionInputs } }
    ).dataCollectionService = {
      listTransactionInputs: mockListTransactionInputs,
    };
    jest.spyOn(svc, 'getSampleIdsForFileRefs').mockImplementation(mockGetSampleIdsForFileRefs);
  });

  it('returns only objects that are not linked to a sample', async () => {
    const res = await svc.listUnlinkedBucketObjects(labFixture(), {});
    expect(res.Contents?.map((o: { Key?: string }) => o.Key)).toEqual(['org-1/lab-1/unlinked.fq.gz']);
    expect(res.IsTruncated).toBe(false);
    expect(res).not.toHaveProperty('ListingTruncated');
  });
});
