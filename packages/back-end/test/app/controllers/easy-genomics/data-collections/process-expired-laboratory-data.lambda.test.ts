process.env.NAME_PREFIX = 'unit-test';

import { Context, ScheduledEvent } from 'aws-lambda';

const mockListLabs: jest.Mock = jest.fn();
const mockListFileRows: jest.Mock = jest.fn();
const mockDeleteRow: jest.Mock = jest.fn();
const mockDeleteObject: jest.Mock = jest.fn();
const mockDeleteObjects: jest.Mock = jest.fn();
const mockListBucketObjectsV2: jest.Mock = jest.fn();
const mockListTags: jest.Mock = jest.fn();
const mockListS3AccessByLaboratoryId: jest.Mock = jest.fn();
const mockListExpiredRunOutputs: jest.Mock = jest.fn();
const mockMarkExpiredRunOutputCompleted: jest.Mock = jest.fn();
const mockRecordExpiredRunOutput: jest.Mock = jest.fn();
const mockQueryRunsByLaboratoryId: jest.Mock = jest.fn();

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    listAllLaboratories: mockListLabs,
  })),
}));

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service', () => ({
  LaboratoryRunService: jest.fn().mockImplementation(() => ({
    queryByLaboratoryId: mockQueryRunsByLaboratoryId,
  })),
}));

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-s3-access-service', () => ({
  LaboratoryS3AccessService: jest.fn().mockImplementation(() => ({
    listByLaboratoryId: mockListS3AccessByLaboratoryId,
  })),
}));

jest.mock('../../../../../src/app/services/easy-genomics/s3-bucket-catalog-service', () => ({
  isDataTaggedS3Bucket: jest.fn().mockResolvedValue(true),
  listDataTaggedS3Buckets: jest.fn().mockResolvedValue([{ name: 'my-bucket' }]),
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
      listExpiredRunOutputsForLab: mockListExpiredRunOutputs,
      markExpiredRunOutputCompleted: mockMarkExpiredRunOutputCompleted,
      recordExpiredRunOutput: mockRecordExpiredRunOutput,
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
    deleteObjects: mockDeleteObjects,
    listBucketObjectsV2: mockListBucketObjectsV2,
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
    // Orphan reconciliation has its own suite below; disable it here so these tests exercise the
    // file sweep in isolation and do not share the S3 / tagging mocks with it.
    process.env.MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP = '0';

    mockListLabs.mockReset().mockResolvedValue([lab]);
    mockListFileRows.mockReset().mockResolvedValue([]);
    mockDeleteRow.mockReset().mockResolvedValue(undefined);
    mockDeleteObject.mockReset().mockResolvedValue({});
    mockDeleteObjects.mockReset().mockResolvedValue({ Errors: [] });
    mockListBucketObjectsV2.mockReset().mockResolvedValue({ Contents: [], IsTruncated: false });
    mockListExpiredRunOutputs.mockReset().mockResolvedValue([]);
    mockMarkExpiredRunOutputCompleted.mockReset().mockResolvedValue(undefined);
    mockRecordExpiredRunOutput.mockReset().mockResolvedValue(undefined);
    mockQueryRunsByLaboratoryId.mockReset().mockResolvedValue([]);
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

describe('process-expired-laboratory-data.lambda expired run outputs', () => {
  const lab = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    S3Bucket: 'my-bucket',
  };

  const runFolder = 'org-1/lab-1/aws-healthomics/run-1';
  const outputPrefix = `${runFolder}/results/`;
  const sampleSheetKey = `${runFolder}/samplesheet.csv`;

  const marker = {
    RunId: 'run-1',
    S3Bucket: 'my-bucket',
    OutputPrefix: outputPrefix,
    SampleSheetKeys: [sampleSheetKey],
    RecordedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DRY_RUN = 'false';
    delete process.env.MAX_DELETES_PER_LAB_SWEEP;
    // Covered by its own suite below; keep the S3 mocks here dedicated to the output sweep.
    process.env.MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP = '0';

    mockListLabs.mockReset().mockResolvedValue([lab]);
    mockListFileRows.mockReset().mockResolvedValue([]);
    mockDeleteRow.mockReset().mockResolvedValue(undefined);
    mockDeleteObject.mockReset().mockResolvedValue({});
    mockDeleteObjects.mockReset().mockResolvedValue({ Errors: [] });
    mockListBucketObjectsV2.mockReset().mockResolvedValue({ Contents: [], IsTruncated: false });
    mockListTags.mockReset().mockResolvedValue({ Tags: [] });
    mockListExpiredRunOutputs.mockReset().mockResolvedValue([]);
    mockMarkExpiredRunOutputCompleted.mockReset().mockResolvedValue(undefined);
    mockRecordExpiredRunOutput.mockReset().mockResolvedValue(undefined);
    mockQueryRunsByLaboratoryId.mockReset().mockResolvedValue([]);
    mockListS3AccessByLaboratoryId
      .mockReset()
      .mockResolvedValue([{ LaboratoryId: 'lab-1', OrganizationId: 'org-1', BucketName: 'my-bucket' }]);
  });

  it('deletes every object under results/ (including the prefix placeholder) plus the sample sheet', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListBucketObjectsV2.mockResolvedValueOnce({
      Contents: [{ Key: outputPrefix }, { Key: `${outputPrefix}multiqc.html` }, { Key: `${outputPrefix}nested/x.bam` }],
      IsTruncated: false,
    });

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).toHaveBeenCalledTimes(1);
    const deleted = mockDeleteObjects.mock.calls[0][0].Delete.Objects.map((o: { Key: string }) => o.Key);
    expect(deleted).toEqual([
      outputPrefix,
      `${outputPrefix}multiqc.html`,
      `${outputPrefix}nested/x.bam`,
      sampleSheetKey,
    ]);
    expect(mockMarkExpiredRunOutputCompleted).toHaveBeenCalledWith('lab-1', 'run-1');
  });

  it('skips a prefix that a surviving run still publishes into', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockQueryRunsByLaboratoryId.mockResolvedValueOnce([
      { RunId: 'run-2', OutputS3Url: `s3://my-bucket/${outputPrefix}` },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('honors DRY_RUN by listing without deleting and keeps the marker row', async () => {
    process.env.DRY_RUN = 'true';
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListBucketObjectsV2.mockResolvedValueOnce({
      Contents: [{ Key: `${outputPrefix}multiqc.html` }],
      IsTruncated: false,
    });

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('keeps the marker row when the delete budget truncates the prefix', async () => {
    process.env.MAX_DELETES_PER_LAB_SWEEP = '1';
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListBucketObjectsV2.mockResolvedValueOnce({
      Contents: [{ Key: `${outputPrefix}a.bam` }, { Key: `${outputPrefix}b.bam` }],
      IsTruncated: false,
    });

    await handler(event, ctx, jest.fn());

    const deleted = mockDeleteObjects.mock.calls[0][0].Delete.Objects.map((o: { Key: string }) => o.Key);
    expect(deleted).toEqual([`${outputPrefix}a.bam`]);
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('paginates the prefix listing before deleting', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListBucketObjectsV2
      .mockResolvedValueOnce({
        Contents: [{ Key: `${outputPrefix}a.bam` }],
        IsTruncated: true,
        NextContinuationToken: 'token-1',
      })
      .mockResolvedValueOnce({ Contents: [{ Key: `${outputPrefix}b.bam` }], IsTruncated: false });

    await handler(event, ctx, jest.fn());

    expect(mockListBucketObjectsV2).toHaveBeenCalledTimes(2);
    const deleted = mockDeleteObjects.mock.calls[0][0].Delete.Objects.map((o: { Key: string }) => o.Key);
    expect(deleted).toEqual([`${outputPrefix}a.bam`, `${outputPrefix}b.bam`]);
    expect(mockMarkExpiredRunOutputCompleted).toHaveBeenCalledWith('lab-1', 'run-1');
  });

  it('skips markers whose recorded keys fall outside the laboratory prefix', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([
      { ...marker, OutputPrefix: 'org-2/lab-9/aws-healthomics/run-1/results/', SampleSheetKeys: undefined },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('removes the marker row when the run folder is already empty', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListBucketObjectsV2.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).toHaveBeenCalledWith('lab-1', 'run-1');
  });

  it('does not re-sweep a marker that has already been completed', async () => {
    mockListExpiredRunOutputs.mockResolvedValue([{ ...marker, CompletedAt: '2026-02-01T00:00:00.000Z' }]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });
});

describe('process-expired-laboratory-data.lambda orphaned run folder reconciliation', () => {
  const lab = {
    LaboratoryId: 'lab-1',
    OrganizationId: 'org-1',
    S3Bucket: 'my-bucket',
  };

  const EXPIRED_RUN_ID = '11111111-2222-4333-8444-555555555555';
  const LIVE_RUN_ID = '99999999-8888-4777-8666-555555555555';

  const labPrefix = 'org-1/lab-1/';
  const platformPrefix = `${labPrefix}aws-healthomics/`;
  const runFolder = `${platformPrefix}${EXPIRED_RUN_ID}/`;

  const OLD = new Date('2020-01-01T00:00:00.000Z');
  const NOW = new Date();

  /**
   * The pass walks prefixes with a delimiter, then lists objects without one. Route each call by
   * the shape of its input so tests can describe a bucket layout rather than a call sequence.
   */
  function mockBucket(layout: { prefixes?: Record<string, string[]>; objects?: Record<string, unknown[]> }): void {
    mockListBucketObjectsV2.mockImplementation(async (input: { Prefix: string; Delimiter?: string }) => {
      if (input.Delimiter) {
        return {
          CommonPrefixes: (layout.prefixes?.[input.Prefix] || []).map((Prefix) => ({ Prefix })),
          IsTruncated: false,
        };
      }
      return { Contents: layout.objects?.[input.Prefix] || [], IsTruncated: false };
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DRY_RUN = 'false';
    delete process.env.MAX_DELETES_PER_LAB_SWEEP;
    delete process.env.ORPHAN_SCAN_MIN_AGE_DAYS;
    delete process.env.MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP;

    mockListLabs.mockReset().mockResolvedValue([lab]);
    mockListFileRows.mockReset().mockResolvedValue([]);
    mockDeleteRow.mockReset().mockResolvedValue(undefined);
    mockDeleteObject.mockReset().mockResolvedValue({});
    mockDeleteObjects.mockReset().mockResolvedValue({ Errors: [] });
    mockListBucketObjectsV2.mockReset();
    mockListTags.mockReset().mockResolvedValue({ Tags: [] });
    mockListExpiredRunOutputs.mockReset().mockResolvedValue([]);
    mockMarkExpiredRunOutputCompleted.mockReset().mockResolvedValue(undefined);
    mockRecordExpiredRunOutput.mockReset().mockResolvedValue(undefined);
    mockQueryRunsByLaboratoryId.mockReset().mockResolvedValue([]);
    mockListS3AccessByLaboratoryId
      .mockReset()
      .mockResolvedValue([{ LaboratoryId: 'lab-1', OrganizationId: 'org-1', BucketName: 'my-bucket' }]);
  });

  it('records the results prefix and sample sheet of an orphaned run folder', async () => {
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: {
        [runFolder]: [
          { Key: `${runFolder}reads_R1.fq.gz`, LastModified: OLD },
          { Key: `${runFolder}samplesheet-old-run.csv`, LastModified: OLD },
          { Key: `${runFolder}results/multiqc.html`, LastModified: OLD },
        ],
      },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).toHaveBeenCalledWith('lab-1', {
      RunId: EXPIRED_RUN_ID,
      S3Bucket: 'my-bucket',
      OutputPrefix: `${runFolder}results/`,
      SampleSheetKeys: [`${runFolder}samplesheet-old-run.csv`],
      RecordedAt: expect.any(String),
    });
  });

  it('never schedules input files for deletion, only results and sample sheets', async () => {
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: {
        [runFolder]: [
          { Key: `${runFolder}reads_R1.fq.gz`, LastModified: OLD },
          { Key: `${runFolder}results/out.bam`, LastModified: OLD },
        ],
      },
    });

    await handler(event, ctx, jest.fn());

    const recorded = mockRecordExpiredRunOutput.mock.calls[0][1];
    expect(recorded.OutputPrefix).toBe(`${runFolder}results/`);
    expect(recorded.SampleSheetKeys).toBeUndefined();
  });

  it('skips folders belonging to a run that still exists', async () => {
    const liveFolder = `${platformPrefix}${LIVE_RUN_ID}/`;
    mockQueryRunsByLaboratoryId.mockResolvedValue([{ RunId: LIVE_RUN_ID }]);
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [liveFolder] },
      objects: { [liveFolder]: [{ Key: `${liveFolder}results/out.bam`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
  });

  it('leaves a recently-touched folder untouched and unrecorded so an in-flight upload survives', async () => {
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: {
        [runFolder]: [
          { Key: `${runFolder}reads_R1.fq.gz`, LastModified: OLD },
          { Key: `${runFolder}reads_R2.fq.gz`, LastModified: NOW },
        ],
      },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
  });

  it('skips folders that already carry a marker row, including completed ones', async () => {
    mockListExpiredRunOutputs.mockResolvedValue([
      { RunId: EXPIRED_RUN_ID, S3Bucket: 'my-bucket', RecordedAt: '', CompletedAt: '2026-02-01T00:00:00.000Z' },
    ]);
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}results/out.bam`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
  });

  it('records an immediately-completed row for folders with nothing deletable, to avoid rescanning', async () => {
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}reads_R1.fq.gz`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    const recorded = mockRecordExpiredRunOutput.mock.calls[0][1];
    expect(recorded.OutputPrefix).toBeUndefined();
    expect(recorded.SampleSheetKeys).toBeUndefined();
    expect(recorded.CompletedAt).toEqual(expect.any(String));
  });

  it('leaves the results prefix alone when an object under it is a tracked file row', async () => {
    mockListFileRows.mockResolvedValue([{ ObjectKey: `${runFolder}results/out.bam`, TagIds: [] }]);
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: {
        [runFolder]: [
          { Key: `${runFolder}results/out.bam`, LastModified: OLD },
          { Key: `${runFolder}samplesheet.csv`, LastModified: OLD },
        ],
      },
    });

    await handler(event, ctx, jest.fn());

    const recorded = mockRecordExpiredRunOutput.mock.calls[0][1];
    expect(recorded.OutputPrefix).toBeUndefined();
    expect(recorded.SampleSheetKeys).toEqual([`${runFolder}samplesheet.csv`]);
  });

  it('ignores non-UUID directories such as a stray results folder at lab level', async () => {
    mockBucket({ prefixes: { [labPrefix]: [`${labPrefix}results/`] } });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
  });

  it('records nothing while DRY_RUN is on', async () => {
    process.env.DRY_RUN = 'true';
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}results/out.bam`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
  });

  it('honors MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP so a large backlog drains over several nights', async () => {
    const second = `${platformPrefix}22222222-3333-4444-8555-666666666666/`;
    process.env.MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP = '1';
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder, second] },
      objects: {
        [runFolder]: [{ Key: `${runFolder}results/a.bam`, LastModified: OLD }],
        [second]: [{ Key: `${second}results/b.bam`, LastModified: OLD }],
      },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).toHaveBeenCalledTimes(1);
  });

  it('respects a custom ORPHAN_SCAN_MIN_AGE_DAYS window', async () => {
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    process.env.ORPHAN_SCAN_MIN_AGE_DAYS = '10';
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}results/a.bam`, LastModified: elevenDaysAgo }] },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).toHaveBeenCalledTimes(1);
  });
});
