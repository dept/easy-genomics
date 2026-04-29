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

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new LaboratoryDataTaggingService();
    mockGetItem = jest.fn();
    mockPutItem = jest.fn().mockResolvedValue({});
    mockDeleteItem = jest.fn().mockResolvedValue({});
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { putItem: typeof mockPutItem }).putItem = mockPutItem;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
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
});
