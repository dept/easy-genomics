process.env.NAME_PREFIX = 'unit-test';

import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  decodeS3ObjectRef,
  encodeS3ObjectRef,
  LaboratoryDataTaggingService,
} from '../../../../src/app/services/easy-genomics/laboratory-data-tagging-service';

function labFixture(overrides?: Partial<Laboratory>): Laboratory {
  return {
    OrganizationId: 'org-1',
    LaboratoryId: 'lab-1',
    S3Bucket: 'my-bucket',
    ...overrides,
  } as Laboratory;
}

describe('LaboratoryDataTaggingService helpers', () => {
  it('round-trips S3 refs via base64url encoding', () => {
    const ref = encodeS3ObjectRef('b', 'org-1/lab-1/a/b.txt');
    expect(decodeS3ObjectRef(ref)).toEqual({ bucket: 'b', key: 'org-1/lab-1/a/b.txt' });
  });

  it('assertKeyUnderLabPrefix accepts keys under org/lab root', () => {
    const svc = new LaboratoryDataTaggingService();
    const lab = labFixture();
    expect(() => svc.assertKeyUnderLabPrefix(lab, 'org-1/lab-1/file.txt')).not.toThrow();
  });

  it('assertKeyUnderLabPrefix rejects keys outside the laboratory prefix', () => {
    const svc = new LaboratoryDataTaggingService();
    const lab = labFixture();
    expect(() => svc.assertKeyUnderLabPrefix(lab, 'other-org/lab-1/file.txt')).toThrow(
      'S3 key is outside the laboratory prefix',
    );
  });

  it('assertBucketMatchesLab rejects mismatched bucket', () => {
    const svc = new LaboratoryDataTaggingService();
    const lab = labFixture();
    expect(() => svc.assertBucketMatchesLab(lab, 'wrong-bucket')).toThrow(
      'S3 bucket does not match laboratory configuration',
    );
  });
});

describe('LaboratoryDataTaggingService.applyTagsToFiles', () => {
  let svc: LaboratoryDataTaggingService;
  let mockGetItem: jest.Mock;
  let mockPutItem: jest.Mock;
  let mockDeleteItem: jest.Mock;
  let mockQueryItems: jest.Mock;
  let mockUpdateItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockGetItem = jest.fn();
    mockPutItem = jest.fn().mockResolvedValue({});
    mockDeleteItem = jest.fn().mockResolvedValue({});
    mockQueryItems = jest.fn().mockResolvedValue({ Items: [] });
    mockUpdateItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { putItem: typeof mockPutItem }).putItem = mockPutItem;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
  });

  it('does not create duplicate MAP rows when re-applying the same tag to a file', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/sample.txt';
    const tagId = 'tag-uuid-1';
    const ref = encodeS3ObjectRef(bucket, key);

    mockGetItem.mockImplementation(async (input: { Key?: Record<string, AttributeValue> }) => {
      const k = unmarshall(input.Key as Record<string, AttributeValue>) as { Sk?: string };
      if (k.Sk === `TAG#${tagId}`) {
        return {
          Item: marshall({
            LaboratoryId: lab.LaboratoryId,
            Sk: k.Sk,
            TagId: tagId,
            Name: 'Alpha',
            ColorHex: '#112233',
            FileCount: 0,
          }),
        };
      }
      if (k.Sk === `FILE#${ref}`) {
        return {
          Item: marshall({
            LaboratoryId: lab.LaboratoryId,
            Sk: k.Sk,
            S3Bucket: bucket,
            ObjectKey: key,
            TagIds: [tagId],
          }),
        };
      }
      return {};
    });

    await svc.applyTagsToFiles(lab, 'user-1', bucket, [key], [tagId], []);

    const mapPuts = mockPutItem.mock.calls.filter((c) => {
      const item = c[0]?.Item;
      if (!item) return false;
      const row = unmarshall(item) as { Sk?: string };
      return row.Sk?.startsWith('MAP#');
    });

    expect(mapPuts).toHaveLength(0);
  });

  it('writes FILE and MAP rows when adding a new tag to an untagged file', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/new.txt';
    const tagId = 'tag-uuid-2';
    const ref = encodeS3ObjectRef(bucket, key);

    mockGetItem.mockImplementation(async (input: { Key?: Record<string, AttributeValue> }) => {
      const k = unmarshall(input.Key as Record<string, AttributeValue>) as { Sk?: string };
      if (k.Sk === `TAG#${tagId}`) {
        return {
          Item: marshall({
            LaboratoryId: lab.LaboratoryId,
            Sk: k.Sk,
            TagId: tagId,
            Name: 'Beta',
            ColorHex: '#AABBCC',
            FileCount: 0,
          }),
        };
      }
      if (k.Sk === `FILE#${ref}`) {
        return {};
      }
      return {};
    });

    await svc.applyTagsToFiles(lab, 'user-1', bucket, [key], [tagId], []);

    const mapPuts = mockPutItem.mock.calls.filter((c) => {
      const item = c[0]?.Item;
      if (!item) return false;
      const row = unmarshall(item) as { Sk?: string; Gsi1Pk?: string };
      return row.Sk?.startsWith('MAP#');
    });
    const filePuts = mockPutItem.mock.calls.filter((c) => {
      const item = c[0]?.Item;
      if (!item) return false;
      const row = unmarshall(item) as { Sk?: string; TagIds?: string[] };
      return row.Sk?.startsWith('FILE#');
    });

    expect(mapPuts.length).toBeGreaterThanOrEqual(1);
    expect(filePuts.length).toBeGreaterThanOrEqual(1);
    const fileRow = unmarshall(filePuts[0][0].Item) as { TagIds: string[] };
    expect(fileRow.TagIds).toContain(tagId);
  });

  it('rejects adding more than one batch tag in a single request', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/a.txt';
    const b1 = 'batch-1';
    const b2 = 'batch-2';

    mockQueryItems.mockResolvedValue({
      Items: [
        marshall({
          LaboratoryId: lab.LaboratoryId,
          Sk: `TAG#${b1}`,
          TagId: b1,
          Name: 'B1',
          ColorHex: '#111111',
          Kind: 'batch',
          FileCount: 0,
        }),
        marshall({
          LaboratoryId: lab.LaboratoryId,
          Sk: `TAG#${b2}`,
          TagId: b2,
          Name: 'B2',
          ColorHex: '#222222',
          Kind: 'batch',
          FileCount: 0,
        }),
      ],
    });

    mockGetItem.mockImplementation(async (input: { Key?: Record<string, AttributeValue> }) => {
      const k = unmarshall(input.Key as Record<string, AttributeValue>) as { Sk?: string };
      if (k.Sk === `TAG#${b1}`) {
        return {
          Item: marshall({
            LaboratoryId: lab.LaboratoryId,
            Sk: k.Sk,
            TagId: b1,
            Name: 'B1',
            ColorHex: '#111111',
            Kind: 'batch',
            FileCount: 0,
          }),
        };
      }
      if (k.Sk === `TAG#${b2}`) {
        return {
          Item: marshall({
            LaboratoryId: lab.LaboratoryId,
            Sk: k.Sk,
            TagId: b2,
            Name: 'B2',
            ColorHex: '#222222',
            Kind: 'batch',
            FileCount: 0,
          }),
        };
      }
      return {};
    });

    await expect(svc.applyTagsToFiles(lab, 'user-1', bucket, [key], [b1, b2], [])).rejects.toThrow(
      'Cannot add more than one batch tag at a time',
    );
  });
});

describe('LaboratoryDataTaggingService.listTags', () => {
  let svc: LaboratoryDataTaggingService;
  let mockQueryItems: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockQueryItems = jest.fn().mockResolvedValue({ Items: [] });
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
  });

  it('infers workflow Kind from Gsi1Sk when Kind, Platform, and Gsi1Pk are missing', async () => {
    const lab = labFixture();
    const wfTagId = 'wf111111-1111-4111-8111-111111111111';
    mockQueryItems.mockResolvedValue({
      Items: [
        marshall({
          LaboratoryId: lab.LaboratoryId,
          Sk: `TAG#${wfTagId}`,
          TagId: wfTagId,
          Name: 'nf-core/rnaseq',
          ColorHex: '#5B4FD4',
          FileCount: 3,
          Gsi1Sk: 'AWS HealthOmics#seed-omics-rnaseq#3.14.0',
        }),
      ],
    });

    const { Tags } = await svc.listTags(lab.LaboratoryId);
    expect(Tags).toHaveLength(1);
    expect(Tags[0].Kind).toBe('workflow');
    expect(Tags[0].Platform).toBe('AWS HealthOmics');
    expect(Tags[0].WorkflowExternalId).toBe('seed-omics-rnaseq');
    expect(Tags[0].WorkflowVersionName).toBe('3.14.0');
  });
});

describe('LaboratoryDataTaggingService.listFileTags', () => {
  let svc: LaboratoryDataTaggingService;
  let mockQueryItems: jest.Mock;
  let mockBatchGetItem: jest.Mock;

  const tableName = `${process.env.NAME_PREFIX}-laboratory-data-tagging-table`;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockQueryItems = jest.fn().mockResolvedValue({ Items: [] });
    mockBatchGetItem = jest.fn();
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
    (svc as unknown as { batchGetItem: typeof mockBatchGetItem }).batchGetItem = mockBatchGetItem;
  });

  it('classifies workflow tag ids via BatchGetItem when listTags returns no workflow rows yet', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/reads.fq.gz';
    const wfTagId = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const stdTagId = 'bbbbbbbb-cccc-4ddd-eeee-ffffffffffff';
    const ref = encodeS3ObjectRef(bucket, key);

    mockQueryItems.mockResolvedValue({ Items: [] });

    mockBatchGetItem.mockImplementation(async (cmd: { RequestItems?: Record<string, { Keys?: unknown[] }> }) => {
      const keys = (cmd.RequestItems?.[tableName]?.Keys || []) as Record<string, AttributeValue>[];
      const rows: Record<string, AttributeValue>[] = [];
      for (const k of keys) {
        const row = unmarshall(k) as { Sk: string; LaboratoryId: string };
        if (row.Sk === `FILE#${ref}`) {
          rows.push(
            marshall({
              LaboratoryId: lab.LaboratoryId,
              Sk: row.Sk,
              S3Bucket: bucket,
              ObjectKey: key,
              TagIds: [wfTagId, stdTagId],
            }),
          );
        } else if (row.Sk === `TAG#${wfTagId}`) {
          rows.push(
            marshall({
              LaboratoryId: lab.LaboratoryId,
              Sk: row.Sk,
              TagId: wfTagId,
              Name: 'nf-core/rnaseq',
              Kind: 'workflow',
              Platform: 'AWS HealthOmics',
              WorkflowExternalId: 'wf-ext',
              ColorHex: '#5B4FD4',
              FileCount: 2,
            }),
          );
        } else if (row.Sk === `TAG#${stdTagId}`) {
          rows.push(
            marshall({
              LaboratoryId: lab.LaboratoryId,
              Sk: row.Sk,
              TagId: stdTagId,
              Name: 'My label',
              ColorHex: '#111111',
              FileCount: 1,
            }),
          );
        }
      }

      return {
        Responses: {
          [tableName]: rows,
        },
      };
    });

    const assignments = await svc.listFileTags(lab.LaboratoryId, bucket, [key]);

    expect(assignments).toHaveLength(1);
    expect(assignments[0].TagIds).toEqual([stdTagId]);
    expect(assignments[0].WorkflowTagIds).toEqual([wfTagId]);
    expect(mockBatchGetItem).toHaveBeenCalledTimes(2);
  });

  it('returns LaboratoryRunUsages sorted newest first by RunCreatedAt', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/sample.fq.gz';
    const ref = encodeS3ObjectRef(bucket, key);

    mockQueryItems.mockResolvedValue({ Items: [] });

    mockBatchGetItem.mockImplementation(async (cmd: { RequestItems?: Record<string, { Keys?: unknown[] }> }) => {
      const keys = (cmd.RequestItems?.[tableName]?.Keys || []) as Record<string, AttributeValue>[];
      const rows: Record<string, AttributeValue>[] = [];
      for (const k of keys) {
        const row = unmarshall(k) as { Sk: string };
        if (row.Sk === `FILE#${ref}`) {
          rows.push(
            marshall({
              LaboratoryId: lab.LaboratoryId,
              Sk: row.Sk,
              S3Bucket: bucket,
              ObjectKey: key,
              TagIds: [],
              LaboratoryRunUsages: {
                'run-older': {
                  RunId: 'run-older',
                  RunName: 'Older run',
                  RunCreatedAt: '2026-01-02T00:00:00.000Z',
                  InputFileCount: 1,
                  InputFileKeys: [key],
                },
                'run-newer': {
                  RunId: 'run-newer',
                  RunName: 'Newer run',
                  WorkflowName: 'nf-core/rnaseq',
                  RunCreatedAt: '2026-02-03T00:00:00.000Z',
                  InputFileCount: 2,
                  InputFileKeys: [key, 'org-1/lab-1/other.fq.gz'],
                },
              },
            }),
          );
        }
      }
      return { Responses: { [tableName]: rows } };
    });

    const assignments = await svc.listFileTags(lab.LaboratoryId, bucket, [key]);

    expect(assignments).toHaveLength(1);
    const usages = assignments[0].LaboratoryRunUsages!;
    expect(usages.map((u) => u.RunId)).toEqual(['run-newer', 'run-older']);
    expect(usages[0].WorkflowName).toBe('nf-core/rnaseq');
    expect(usages[1].InputFileCount).toBe(1);
  });
});

describe('LaboratoryDataTaggingService.recordLaboratoryRunInputUsage', () => {
  let svc: LaboratoryDataTaggingService;
  let mockUpdateItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockUpdateItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
  });

  it('initialises the LaboratoryRunUsages map then sets the run-keyed entry', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/sample.fq.gz';

    await svc.recordLaboratoryRunInputUsage(lab, 'user-1', bucket, [key], {
      RunId: 'run-1',
      RunName: 'Test run',
      WorkflowName: 'nf-core/rnaseq',
      RunCreatedAt: '2026-05-10T12:00:00.000Z',
      InputFileCount: 1,
      InputFileKeys: [key],
    });

    expect(mockUpdateItem).toHaveBeenCalledTimes(2);
    const initCall = mockUpdateItem.mock.calls[0][0];
    const setCall = mockUpdateItem.mock.calls[1][0];
    expect(initCall.UpdateExpression).toContain('if_not_exists(#lru, :emptyMap)');
    expect(setCall.UpdateExpression).toContain('SET #lru.#rid = :summary');
    expect(setCall.ConditionExpression).toContain('attribute_not_exists(#lru.#rid)');
    expect(setCall.ExpressionAttributeNames['#rid']).toBe('run-1');
  });

  it('is idempotent when the RunId entry already exists', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/sample.fq.gz';

    mockUpdateItem.mockImplementation(async (input: { ConditionExpression?: string }) => {
      if (input.ConditionExpression && input.ConditionExpression.includes('attribute_not_exists(#lru.#rid)')) {
        throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
      }
      return {};
    });

    await expect(
      svc.recordLaboratoryRunInputUsage(lab, 'user-1', bucket, [key], {
        RunId: 'run-1',
        RunName: 'Test run',
        RunCreatedAt: '2026-05-10T12:00:00.000Z',
        InputFileCount: 1,
        InputFileKeys: [key],
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects keys outside the laboratory prefix', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    await expect(
      svc.recordLaboratoryRunInputUsage(lab, 'user-1', bucket, ['other-org/lab-1/foo.txt'], {
        RunId: 'run-1',
        RunName: 'Test',
        RunCreatedAt: '2026-05-10T12:00:00.000Z',
        InputFileCount: 1,
        InputFileKeys: ['other-org/lab-1/foo.txt'],
      }),
    ).rejects.toThrow('S3 key is outside the laboratory prefix');
  });
});

describe('LaboratoryDataTaggingService.removeLaboratoryRunUsageForRunIds', () => {
  let svc: LaboratoryDataTaggingService;
  let mockGetItem: jest.Mock;
  let mockUpdateItem: jest.Mock;
  let mockDeleteItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockGetItem = jest.fn();
    mockUpdateItem = jest.fn().mockResolvedValue({});
    mockDeleteItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
  });

  it('removes the run-keyed entry and deletes the FILE row when no tags or usages remain', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/sample.fq.gz';
    const ref = encodeS3ObjectRef(bucket, key);

    // After the REMOVE has cleared the only usage, the FILE row is now empty (no tags, no usages).
    mockGetItem.mockResolvedValue({
      Item: marshall({
        LaboratoryId: lab.LaboratoryId,
        Sk: `FILE#${ref}`,
        S3Bucket: bucket,
        ObjectKey: key,
        TagIds: [],
        LaboratoryRunUsages: {},
      }),
    });

    await svc.removeLaboratoryRunUsageForRunIds(lab, bucket, { 'run-1': [key] });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdateItem.mock.calls[0][0];
    expect(updateCall.UpdateExpression).toBe('REMOVE #lru.#rid');
    expect(updateCall.ExpressionAttributeNames['#rid']).toBe('run-1');
    expect(updateCall.ConditionExpression).toContain('attribute_exists(#lru.#rid)');

    expect(mockDeleteItem).toHaveBeenCalledTimes(1);
    const deletedSk = (unmarshall(mockDeleteItem.mock.calls[0][0].Key) as { Sk?: string }).Sk;
    expect(deletedSk).toBe(`FILE#${ref}`);
  });

  it('preserves the FILE row when other tags remain after removing a run usage', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/keep.fq.gz';
    const ref = encodeS3ObjectRef(bucket, key);

    mockGetItem.mockResolvedValue({
      Item: marshall({
        LaboratoryId: lab.LaboratoryId,
        Sk: `FILE#${ref}`,
        S3Bucket: bucket,
        ObjectKey: key,
        TagIds: ['some-other-tag'],
        LaboratoryRunUsages: {},
      }),
    });

    await svc.removeLaboratoryRunUsageForRunIds(lab, bucket, { 'run-1': [key] });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('preserves the FILE row when other run usages remain after removing one', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/multi.fq.gz';
    const ref = encodeS3ObjectRef(bucket, key);

    mockGetItem.mockResolvedValue({
      Item: marshall({
        LaboratoryId: lab.LaboratoryId,
        Sk: `FILE#${ref}`,
        S3Bucket: bucket,
        ObjectKey: key,
        TagIds: [],
        LaboratoryRunUsages: {
          'run-2': {
            RunId: 'run-2',
            RunName: 'Other run',
            RunCreatedAt: '2026-02-01T00:00:00.000Z',
            InputFileCount: 1,
            InputFileKeys: [key],
          },
        },
      }),
    });

    await svc.removeLaboratoryRunUsageForRunIds(lab, bucket, { 'run-1': [key] });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('is idempotent when the RunId entry is already absent (conditional check failure)', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/absent.fq.gz';

    mockUpdateItem.mockImplementation(async () => {
      throw Object.assign(new Error('Conditional check failed'), { name: 'ConditionalCheckFailedException' });
    });

    await expect(svc.removeLaboratoryRunUsageForRunIds(lab, bucket, { 'run-1': [key] })).resolves.toBeUndefined();

    // Conditional failure short-circuits the read+delete branch.
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('skips keys outside the laboratory prefix without throwing', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const outsideKey = 'other-org/lab-1/foo.txt';

    await svc.removeLaboratoryRunUsageForRunIds(lab, bucket, { 'run-1': [outsideKey] });

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });
});

describe('LaboratoryDataTaggingService preserves FILE rows when run usage history exists', () => {
  let svc: LaboratoryDataTaggingService;
  let mockGetItem: jest.Mock;
  let mockPutItem: jest.Mock;
  let mockDeleteItem: jest.Mock;
  let mockQueryItems: jest.Mock;
  let mockUpdateItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockGetItem = jest.fn();
    mockPutItem = jest.fn().mockResolvedValue({});
    mockDeleteItem = jest.fn().mockResolvedValue({});
    mockQueryItems = jest.fn().mockResolvedValue({ Items: [] });
    mockUpdateItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { putItem: typeof mockPutItem }).putItem = mockPutItem;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
  });

  it('rewrites the FILE row with empty TagIds when all tags are removed but usages remain', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/preserved.fq.gz';
    const tagId = 'tag-uuid-keep';
    const ref = encodeS3ObjectRef(bucket, key);

    mockGetItem.mockImplementation(async (input: { Key?: Record<string, AttributeValue> }) => {
      const k = unmarshall(input.Key as Record<string, AttributeValue>) as { Sk?: string };
      if (k.Sk === `TAG#${tagId}`) {
        return {
          Item: marshall({
            LaboratoryId: lab.LaboratoryId,
            Sk: k.Sk,
            TagId: tagId,
            Name: 'Standard',
            ColorHex: '#112233',
            FileCount: 1,
          }),
        };
      }
      if (k.Sk === `FILE#${ref}`) {
        return {
          Item: marshall({
            LaboratoryId: lab.LaboratoryId,
            Sk: k.Sk,
            S3Bucket: bucket,
            ObjectKey: key,
            TagIds: [tagId],
            LaboratoryRunUsages: {
              'run-1': {
                RunId: 'run-1',
                RunName: 'A run',
                RunCreatedAt: '2026-01-01T00:00:00.000Z',
                InputFileCount: 1,
                InputFileKeys: [key],
              },
            },
          }),
        };
      }
      return {};
    });

    await svc.applyTagsToFiles(lab, 'user-1', bucket, [key], [], [tagId]);

    expect(
      mockDeleteItem.mock.calls.some((c) => {
        const sk = (unmarshall(c[0].Key) as { Sk?: string }).Sk;
        return sk === `FILE#${ref}`;
      }),
    ).toBe(false);

    const filePut = mockPutItem.mock.calls
      .map((c) => unmarshall(c[0].Item) as { Sk?: string; TagIds?: string[]; LaboratoryRunUsages?: unknown })
      .find((row) => row.Sk === `FILE#${ref}`);
    expect(filePut).toBeDefined();
    expect(filePut!.TagIds).toEqual([]);
    expect(filePut!.LaboratoryRunUsages).toBeDefined();
  });
});

describe('LaboratoryDataTaggingService.ensurePermanentTag', () => {
  let svc: LaboratoryDataTaggingService;
  let mockGetItem: jest.Mock;
  let mockPutItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockGetItem = jest.fn();
    mockPutItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { putItem: typeof mockPutItem }).putItem = mockPutItem;
  });

  it('returns the existing row when the singleton permanent tag is already provisioned', async () => {
    const lab = labFixture();
    const existingId = svc.getPermanentTagId(lab.LaboratoryId);
    mockGetItem.mockResolvedValueOnce({
      Item: marshall({
        LaboratoryId: lab.LaboratoryId,
        Sk: `TAG#${existingId}`,
        TagId: existingId,
        Name: 'Permanent',
        ColorHex: '#DC2626',
        Kind: 'permanent',
        FileCount: 3,
      }),
    });
    const tag = await svc.ensurePermanentTag(lab, 'user-1');
    expect(tag.Kind).toBe('permanent');
    expect(tag.TagId).toBe(existingId);
    expect(tag.Name).toBe('Permanent');
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('lazy-creates the permanent tag with deterministic id when missing', async () => {
    const lab = labFixture();
    const expectedId = svc.getPermanentTagId(lab.LaboratoryId);
    mockGetItem.mockResolvedValueOnce({});

    const tag = await svc.ensurePermanentTag(lab, 'user-1');
    expect(tag.TagId).toBe(expectedId);
    expect(tag.Kind).toBe('permanent');
    expect(tag.ColorHex).toBe('#DC2626');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const item = unmarshall(mockPutItem.mock.calls[0][0].Item) as { Kind: string; Sk: string; Name: string };
    expect(item.Kind).toBe('permanent');
    expect(item.Sk).toBe(`TAG#${expectedId}`);
    expect(item.Name).toBe('Permanent');
  });

  it('returns the winning row when a concurrent creator wins the ConditionalCheckFailed race', async () => {
    const lab = labFixture();
    const expectedId = svc.getPermanentTagId(lab.LaboratoryId);
    mockGetItem
      .mockResolvedValueOnce({}) // initial getTagRow: not found
      .mockResolvedValueOnce({
        // post-conflict re-read: returns the winning row
        Item: marshall({
          LaboratoryId: lab.LaboratoryId,
          Sk: `TAG#${expectedId}`,
          TagId: expectedId,
          Name: 'Permanent',
          ColorHex: '#DC2626',
          Kind: 'permanent',
          FileCount: 0,
        }),
      });
    mockPutItem.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Conditional check failed'), {
        name: 'ConditionalCheckFailedException',
      });
    });

    const tag = await svc.ensurePermanentTag(lab, 'user-1');
    expect(tag.TagId).toBe(expectedId);
    expect(tag.Kind).toBe('permanent');
  });
});

describe('LaboratoryDataTaggingService.createTag / deleteTag reject permanent kind', () => {
  let svc: LaboratoryDataTaggingService;
  let mockGetItem: jest.Mock;
  let mockQueryItems: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockGetItem = jest.fn();
    mockQueryItems = jest.fn().mockResolvedValue({ Items: [] });
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
    (svc as unknown as { putItem: jest.Mock }).putItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { deleteItem: jest.Mock }).deleteItem = jest.fn().mockResolvedValue({});
  });

  it('createTag rejects kind="permanent"', async () => {
    const lab = labFixture();
    await expect(svc.createTag(lab, 'user-1', 'Whatever', '#DC2626', 'permanent')).rejects.toThrow(
      /Permanent tags cannot be created directly/,
    );
  });

  it('deleteTag rejects an existing permanent tag', async () => {
    const lab = labFixture();
    const pid = svc.getPermanentTagId(lab.LaboratoryId);
    mockGetItem.mockResolvedValueOnce({
      Item: marshall({
        LaboratoryId: lab.LaboratoryId,
        Sk: `TAG#${pid}`,
        TagId: pid,
        Name: 'Permanent',
        ColorHex: '#DC2626',
        Kind: 'permanent',
        FileCount: 0,
      }),
    });
    await expect(svc.deleteTag(lab.LaboratoryId, pid)).rejects.toThrow(/Permanent tags are system-managed/);
  });
});

describe('LaboratoryDataTaggingService.updateRunUsageExpiresAt', () => {
  let svc: LaboratoryDataTaggingService;
  let mockUpdateItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockUpdateItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
  });

  it('SETs ExpiresAt onto each input file row when a value is supplied', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    await svc.updateRunUsageExpiresAt(
      lab,
      bucket,
      'run-7',
      ['org-1/lab-1/a.fq.gz', 'org-1/lab-1/b.fq.gz'],
      1_900_000_000,
    );
    expect(mockUpdateItem).toHaveBeenCalledTimes(2);
    const update = mockUpdateItem.mock.calls[0][0];
    expect(update.UpdateExpression).toMatch(/SET #lru.#rid.#exp = :exp/);
    const values = unmarshall(update.ExpressionAttributeValues) as { ':exp': number };
    expect(values[':exp']).toBe(1_900_000_000);
  });

  it('REMOVEs the ExpiresAt sub-attribute when value is undefined', async () => {
    const lab = labFixture();
    await svc.updateRunUsageExpiresAt(lab, lab.S3Bucket!, 'run-7', ['org-1/lab-1/a.fq.gz'], undefined);
    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    expect(mockUpdateItem.mock.calls[0][0].UpdateExpression).toMatch(/REMOVE #lru.#rid.#exp/);
  });

  it('skips keys that fall outside the laboratory prefix', async () => {
    const lab = labFixture();
    await svc.updateRunUsageExpiresAt(lab, lab.S3Bucket!, 'run-7', ['other-org/lab-1/x.fq.gz'], 1_900_000_000);
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });
});

describe('LaboratoryDataTaggingService.removeLaboratoryRunUsageForRunIds preserveEmptyFileRow', () => {
  let svc: LaboratoryDataTaggingService;
  let mockGetItem: jest.Mock;
  let mockDeleteItem: jest.Mock;
  let mockUpdateItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockGetItem = jest.fn().mockResolvedValue({});
    mockDeleteItem = jest.fn().mockResolvedValue({});
    mockUpdateItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
    (svc as unknown as { updateItem: typeof mockUpdateItem }).updateItem = mockUpdateItem;
  });

  it('with preserveEmptyFileRow=true never deletes the FILE# row even when it ends up empty', async () => {
    const lab = labFixture();
    const bucket = lab.S3Bucket!;
    const key = 'org-1/lab-1/last-usage.fq.gz';

    await svc.removeLaboratoryRunUsageForRunIds(lab, bucket, { 'run-1': [key] }, { preserveEmptyFileRow: true });

    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });
});
