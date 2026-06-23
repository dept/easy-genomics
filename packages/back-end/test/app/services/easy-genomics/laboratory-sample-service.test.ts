process.env.NAME_PREFIX = 'unit-test';

import { ConditionalCheckFailedException, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  S3BucketMismatchError,
  S3KeyOutOfPrefixError,
  SequenceCollectionNotFoundError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
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
  let setBatchForSamplesSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratorySampleService();
    mockCopy = jest.fn().mockResolvedValue(undefined);
    (svc as unknown as { s3Service: { copyBucketObject: typeof mockCopy } }).s3Service = {
      copyBucketObject: mockCopy,
    };
    setBatchForSamplesSpy = jest
      .spyOn(
        (svc as unknown as { taggingService: { setBatchForSamples: jest.Mock } }).taggingService,
        'setBatchForSamples',
      )
      .mockResolvedValue(undefined);
    jest.spyOn(svc, 'createSampleWithImport' as never).mockResolvedValue({ SampleId: 'sample-1' } as never);
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

  it('assigns a new batch when samples are created', async () => {
    const lab = labFixture();
    await svc.bulkCreateSamples(lab, 'user-1', 'my-bucket', {
      importLabel: 'import',
      samples: [{ name: 'sample-a', layout: 'single_end', keys: ['org-1/lab-1/a.fq.gz'] }],
      newBatchName: 'Batch A',
    });

    expect(setBatchForSamplesSpy).toHaveBeenCalledWith(lab, 'user-1', ['sample-1'], {
      type: 'new',
      name: 'Batch A',
    });
  });

  it('assigns an existing batch when batchTagId is provided', async () => {
    const lab = labFixture();
    await svc.bulkCreateSamples(lab, 'user-1', 'my-bucket', {
      importLabel: 'import',
      samples: [{ name: 'sample-a', layout: 'single_end', keys: ['org-1/lab-1/a.fq.gz'] }],
      batchTagId: 'batch-tag-1',
    });

    expect(setBatchForSamplesSpy).toHaveBeenCalledWith(lab, 'user-1', ['sample-1'], {
      type: 'existing',
      batchTagId: 'batch-tag-1',
    });
  });

  it('does not assign a batch when no samples were created', async () => {
    jest.spyOn(svc, 'createSampleWithImport' as never).mockRejectedValue(new Error('create failed') as never);
    const lab = labFixture();
    await svc.bulkCreateSamples(lab, 'user-1', 'my-bucket', {
      importLabel: 'import',
      samples: [{ name: 'sample-a', layout: 'single_end', keys: ['org-1/lab-1/a.fq.gz'] }],
      newBatchName: 'Batch A',
    });

    expect(setBatchForSamplesSpy).not.toHaveBeenCalled();
  });
});

describe('LaboratorySampleService.deleteSequenceCollection', () => {
  let svc: LaboratorySampleService;
  let mockGetItem: jest.Mock;
  let mockQueryItems: jest.Mock;
  let mockDeleteItem: jest.Mock;
  const deleteCalls: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    deleteCalls.length = 0;
    svc = new LaboratorySampleService();
    mockGetItem = jest.fn();
    mockQueryItems = jest.fn();
    mockDeleteItem = jest.fn().mockImplementation(async (input: { Key?: Record<string, AttributeValue> }) => {
      const key = input.Key ? unmarshall(input.Key) : {};
      deleteCalls.push(String(key.Sk));
    });
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
  });

  it('throws when the sequence collection does not exist', async () => {
    mockGetItem.mockResolvedValue({});
    await expect(svc.deleteSequenceCollection('lab-1', 'sc-missing')).rejects.toThrow(SequenceCollectionNotFoundError);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('deletes association rows across GSI pages before the root row', async () => {
    mockGetItem.mockResolvedValue({
      Item: marshall({
        LaboratoryId: 'lab-1',
        Sk: 'SEQUENCE_COLLECTION#sc-1',
        SequenceCollectionId: 'sc-1',
      }),
    });
    mockQueryItems
      .mockResolvedValueOnce({
        Items: [marshall({ Sk: 'SCSET#sc-1#sample-1' }), marshall({ Sk: 'SCSET#sc-1#sample-2' })],
        LastEvaluatedKey: { LaboratoryId: { S: 'lab-1' } },
      })
      .mockResolvedValueOnce({
        Items: [marshall({ Sk: 'SCSET#sc-1#sample-3' })],
      });

    await svc.deleteSequenceCollection('lab-1', 'sc-1');

    expect(mockQueryItems).toHaveBeenCalledTimes(2);
    expect(deleteCalls).toEqual([
      'SCSET#sc-1#sample-1',
      'SCSET#sc-1#sample-2',
      'SCSET#sc-1#sample-3',
      'SEQUENCE_COLLECTION#sc-1',
    ]);
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

    listSampleFilesSpy = jest.spyOn(svc, 'listSampleFiles');
  });

  it('paginates sample files when building the sample sheet', async () => {
    const lab = labFixture();
    const collectionId = 'sc-1';
    const setId = 'sample-1';

    jest.spyOn(svc, 'getSequenceCollection').mockResolvedValue({
      SequenceCollectionId: collectionId,
      Name: 'Run collection',
      Columns: [
        { columnName: 'sample', role: 'sample_id', required: true },
        { columnName: 'fastq_1', role: 'read1', required: true },
      ],
      SampleCount: 1,
    });
    jest.spyOn(svc, 'listSequenceCollectionSampleIds' as never).mockResolvedValue([setId] as never);
    jest.spyOn(svc, 'getSample').mockResolvedValue({
      SampleId: setId,
      Name: 'SampleA',
      Layout: 'single_end',
      FileCount: 501,
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
      'sample-1',
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
        'sample-1',
      ),
    ).rejects.toThrow('ProvisionedThroughputExceededException');
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});

describe('LaboratorySampleService.adjustSequenceCollectionSampleCount', () => {
  let svc: LaboratorySampleService;
  let mockUpdateItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratorySampleService();
    mockUpdateItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
  });

  it('uses atomic ADD for sample count updates', async () => {
    await (
      svc as unknown as { adjustSequenceCollectionSampleCount: (...args: unknown[]) => Promise<void> }
    ).adjustSequenceCollectionSampleCount('lab-1', 'sc-1', 2, 'user-1');

    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        UpdateExpression: 'ADD SampleCount :delta SET ModifiedAt = :ma, ModifiedBy = :mb',
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
        [encodeS3ObjectRef('my-bucket', 'org-1/lab-1/linked.fq.gz'), ['sample-1']],
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
    expect(res.Contents?.map((o) => o.Key)).toEqual(['org-1/lab-1/unlinked.fq.gz']);
    expect(res.IsTruncated).toBe(false);
    expect(res).not.toHaveProperty('ListingTruncated');
  });
});
