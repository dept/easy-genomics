process.env.NAME_PREFIX = 'unit-test';

import { Context, ScheduledEvent } from 'aws-lambda';

const mockListLabs: jest.Mock = jest.fn();
const mockListFileRows: jest.Mock = jest.fn();
const mockDeleteRow: jest.Mock = jest.fn();
const mockDeleteObject: jest.Mock = jest.fn();
const mockListTags: jest.Mock = jest.fn();
const mockListS3AccessByLaboratoryId: jest.Mock = jest.fn();

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    listAllLaboratories: mockListLabs,
  })),
}));

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-s3-access-service', () => ({
  LaboratoryS3AccessService: jest.fn().mockImplementation(() => ({
    listByLaboratoryId: mockListS3AccessByLaboratoryId,
  })),
}));

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service', () => {
  const actual = jest.requireActual('../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service');
  const proto = actual.LaboratoryDataTaggingService.prototype as {
    assertLaboratoryHasS3BucketAccess: (laboratory: unknown, bucket: string) => Promise<void>;
    assertKeyUnderLabPrefix: (laboratory: unknown, key: string) => void;
  };
  return {
    ...actual,
    LaboratoryDataTaggingService: jest.fn().mockImplementation(() => ({
      listAllFileRowsForLab: mockListFileRows,
      deleteFileRowAndAssociations: mockDeleteRow,
      listTags: mockListTags,
      assertLaboratoryHasS3BucketAccess: (laboratory: unknown, bucket: string) =>
        proto.assertLaboratoryHasS3BucketAccess(laboratory as never, bucket),
      assertKeyUnderLabPrefix: (laboratory: unknown, key: string) =>
        proto.assertKeyUnderLabPrefix(laboratory as never, key),
    })),
  };
});

jest.mock('../../../../../src/app/services/s3-service', () => ({
  S3Service: jest.fn().mockImplementation(() => ({
    deleteObject: mockDeleteObject,
  })),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/data-collections/process-expired-laboratory-data.lambda';
import { permanentTagIdForLaboratory } from '../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service';

const ctx = {} as Context;
const event = {} as ScheduledEvent;

describe('process-expired-laboratory-data.lambda eligibility', () => {
  const lab = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    S3Bucket: 'my-bucket',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DRY_RUN = 'false';
    delete process.env.MAX_DELETES_PER_LAB_SWEEP;

    mockListLabs.mockReset().mockResolvedValue([lab]);
    mockListFileRows.mockReset();
    mockDeleteRow.mockReset().mockResolvedValue(undefined);
    mockDeleteObject.mockReset().mockResolvedValue({});
    mockListTags.mockReset().mockResolvedValue({
      Tags: [
        { TagId: 'wf-1', Name: 'WF One', ColorHex: '#000000', Kind: 'workflow', FileCount: 0 },
        { TagId: 'batch-1', Name: 'B1', ColorHex: '#000000', Kind: 'batch', FileCount: 0 },
      ],
    });
    mockListS3AccessByLaboratoryId
      .mockReset()
      .mockResolvedValue([{ LaboratoryId: 'lab-1', OrganizationId: 'org-1', BucketName: 'my-bucket' }]);
  });

  it('deletes the S3 object and tagging rows for files with no usages and a workflow tag', async () => {
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/a.fq.gz',
        TagIds: ['wf-1'],
        LaboratoryRunUsages: undefined,
      },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObject).toHaveBeenCalledWith({ Bucket: 'my-bucket', Key: 'org-1/lab-1/a.fq.gz' });
    expect(mockDeleteRow).toHaveBeenCalledWith('lab-1', 'r1');
  });

  it('skips files that still have at least one referencing run', async () => {
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/a.fq.gz',
        TagIds: ['wf-1'],
        LaboratoryRunUsages: { 'run-1': { RunId: 'run-1' } },
      },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('skips never-used orphans (no workflow tag, no usages)', async () => {
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/orphan.fq.gz',
        TagIds: ['some-standard'],
        LaboratoryRunUsages: undefined,
      },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('protects files tagged Permanent from deletion', async () => {
    const permanentTagId = permanentTagIdForLaboratory(lab.LaboratoryId);
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/locked.fq.gz',
        TagIds: ['wf-1', permanentTagId],
        LaboratoryRunUsages: undefined,
      },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('honors DRY_RUN=true by skipping S3 and tagging-row deletion', async () => {
    process.env.DRY_RUN = 'true';
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/a.fq.gz',
        TagIds: ['wf-1'],
        LaboratoryRunUsages: undefined,
      },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('defaults to dry-run when DRY_RUN is unset (only false enables deletes)', async () => {
    delete process.env.DRY_RUN;
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/a.fq.gz',
        TagIds: ['wf-1'],
        LaboratoryRunUsages: undefined,
      },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('skips deletes when the FILE row bucket does not match the laboratory configuration', async () => {
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'wrong-bucket',
        ObjectKey: 'org-1/lab-1/a.fq.gz',
        TagIds: ['wf-1'],
        LaboratoryRunUsages: undefined,
      },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('respects MAX_DELETES_PER_LAB_SWEEP across multiple eligible rows', async () => {
    process.env.MAX_DELETES_PER_LAB_SWEEP = '1';
    mockListFileRows.mockResolvedValueOnce([
      {
        Ref: 'r1',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/a.fq.gz',
        TagIds: ['wf-1'],
        LaboratoryRunUsages: undefined,
      },
      {
        Ref: 'r2',
        S3Bucket: 'my-bucket',
        ObjectKey: 'org-1/lab-1/b.fq.gz',
        TagIds: ['wf-1'],
        LaboratoryRunUsages: undefined,
      },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteRow).toHaveBeenCalledTimes(1);
  });
});
