process.env.NAME_PREFIX = 'unit-test';

import { Context, ScheduledEvent } from 'aws-lambda';

const mockListLabs: jest.Mock = jest.fn();
const mockListFileRows: jest.Mock = jest.fn();
const mockDeleteRow: jest.Mock = jest.fn();
const mockDeleteObject: jest.Mock = jest.fn();
const mockDeleteObjects: jest.Mock = jest.fn();
const mockListAllObjectsUnderPrefix: jest.Mock = jest.fn();
const mockListAllObjectKeysUnderPrefix: jest.Mock = jest.fn();
const mockListChildPrefixes: jest.Mock = jest.fn();
const mockListTags: jest.Mock = jest.fn();
const mockListS3AccessByLaboratoryId: jest.Mock = jest.fn();
const mockListExpiredRunOutputs: jest.Mock = jest.fn();
const mockMarkExpiredRunOutputCompleted: jest.Mock = jest.fn();
const mockRecordExpiredRunOutput: jest.Mock = jest.fn();
const mockListAllRunsForLaboratory: jest.Mock = jest.fn();

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    listAllLaboratories: mockListLabs,
  })),
}));

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-run-service', () => ({
  LaboratoryRunService: jest.fn().mockImplementation(() => ({
    listAllRunsForLaboratory: mockListAllRunsForLaboratory,
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
    listAllObjectsUnderPrefix: mockListAllObjectsUnderPrefix,
    listAllObjectKeysUnderPrefix: mockListAllObjectKeysUnderPrefix,
    listChildPrefixes: mockListChildPrefixes,
  })),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/data-collections/process-expired-laboratory-data.lambda';
import { permanentTagIdForLaboratory } from '../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service';

const ctx = {} as Context;
const event = {} as ScheduledEvent;

const lab = {
  LaboratoryId: 'lab-1',
  OrganizationId: 'org-1',
  S3Bucket: 'my-bucket',
};

/** Shared baseline: every mock resolves to "nothing to do" so each test states only what it needs. */
function resetMocks(): void {
  jest.clearAllMocks();
  process.env.DRY_RUN = 'false';
  delete process.env.MAX_DELETES_PER_LAB_SWEEP;
  delete process.env.MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP;
  process.env.OUTPUT_DELETION_ENABLED = 'true';
  process.env.ORPHAN_RECONCILIATION_ENABLED = 'true';

  mockListLabs.mockReset().mockResolvedValue([lab]);
  mockListFileRows.mockReset().mockResolvedValue([]);
  mockDeleteRow.mockReset().mockResolvedValue(undefined);
  mockDeleteObject.mockReset().mockResolvedValue({});
  mockDeleteObjects.mockReset().mockResolvedValue({ Errors: [] });
  mockListAllObjectsUnderPrefix.mockReset().mockResolvedValue([]);
  mockListAllObjectKeysUnderPrefix.mockReset().mockResolvedValue([]);
  mockListChildPrefixes.mockReset().mockResolvedValue([]);
  mockListTags.mockReset().mockResolvedValue({ Tags: [] });
  mockListExpiredRunOutputs.mockReset().mockResolvedValue([]);
  mockMarkExpiredRunOutputCompleted.mockReset().mockResolvedValue(undefined);
  mockRecordExpiredRunOutput.mockReset().mockResolvedValue(undefined);
  mockListAllRunsForLaboratory.mockReset().mockResolvedValue([]);
  mockListS3AccessByLaboratoryId
    .mockReset()
    .mockResolvedValue([{ LaboratoryId: 'lab-1', OrganizationId: 'org-1', BucketName: 'my-bucket' }]);
}

describe('process-expired-laboratory-data.lambda eligibility', () => {
  beforeEach(() => {
    resetMocks();
    // Orphan reconciliation has its own suite below; disable it here so these tests exercise the
    // file sweep in isolation.
    process.env.ORPHAN_RECONCILIATION_ENABLED = 'false';
    mockListTags.mockResolvedValue({
      Tags: [
        { TagId: 'wf-1', Name: 'WF One', ColorHex: '#000000', Kind: 'workflow', FileCount: 0 },
        { TagId: 'batch-1', Name: 'B1', ColorHex: '#000000', Kind: 'batch', FileCount: 0 },
      ],
    });
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

describe('process-expired-laboratory-data.lambda delete budget env guards', () => {
  const eligibleRows = [
    { Ref: 'r1', S3Bucket: 'my-bucket', ObjectKey: 'org-1/lab-1/a.fq.gz', TagIds: ['wf-1'] },
    { Ref: 'r2', S3Bucket: 'my-bucket', ObjectKey: 'org-1/lab-1/b.fq.gz', TagIds: ['wf-1'] },
  ];

  beforeEach(() => {
    resetMocks();
    process.env.ORPHAN_RECONCILIATION_ENABLED = 'false';
    mockListTags.mockResolvedValue({
      Tags: [{ TagId: 'wf-1', Name: 'WF One', ColorHex: '#000000', Kind: 'workflow', FileCount: 0 }],
    });
    mockListFileRows.mockResolvedValue(eligibleRows);
  });

  it('treats MAX_DELETES_PER_LAB_SWEEP=0 as a kill switch that deletes nothing', async () => {
    process.env.MAX_DELETES_PER_LAB_SWEEP = '0';

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(mockDeleteRow).not.toHaveBeenCalled();
  });

  it('falls back to the default budget when the value is malformed rather than deleting nothing', async () => {
    process.env.MAX_DELETES_PER_LAB_SWEEP = 'not-a-number';

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
  });

  it('falls back to the default budget when the value is negative', async () => {
    process.env.MAX_DELETES_PER_LAB_SWEEP = '-5';

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
  });
});

describe('process-expired-laboratory-data.lambda expired run outputs', () => {
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
    resetMocks();
    // Covered by its own suite below; keep these tests focused on the output sweep.
    process.env.ORPHAN_RECONCILIATION_ENABLED = 'false';
  });

  it('deletes every object under results/ (including the prefix placeholder) plus the sample sheet', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([
      outputPrefix,
      `${outputPrefix}multiqc.html`,
      `${outputPrefix}nested/x.bam`,
    ]);

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
    mockListAllRunsForLaboratory.mockResolvedValueOnce([
      { RunId: 'run-2', OutputS3Url: `s3://my-bucket/${outputPrefix}` },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('skips a prefix that a surviving legacy run still claims via InputS3Url', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListAllRunsForLaboratory.mockResolvedValueOnce([{ RunId: 'run-2', InputS3Url: `s3://my-bucket/${runFolder}` }]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('keeps a sample sheet that a surviving retry still points at', async () => {
    // `prefillFromFailedRun` copies SampleSheetS3Url verbatim, so a live run's sheet can sit in an
    // expired run's folder. A marker carrying only sample sheets has no prefix check to fall back on.
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, OutputPrefix: undefined }]);
    mockListAllRunsForLaboratory.mockResolvedValueOnce([
      { RunId: 'run-2', SampleSheetS3Url: `s3://my-bucket/${sampleSheetKey}` },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it('fails closed and deletes nothing when the surviving-run set cannot be loaded', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListAllRunsForLaboratory.mockRejectedValueOnce(new Error('DynamoDB throttled'));

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('honors DRY_RUN by listing without deleting and keeps the marker row', async () => {
    process.env.DRY_RUN = 'true';
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([`${outputPrefix}multiqc.html`]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('does nothing at all while OUTPUT_DELETION_ENABLED is off', async () => {
    process.env.OUTPUT_DELETION_ENABLED = 'false';
    mockListExpiredRunOutputs.mockResolvedValueOnce([marker]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([`${outputPrefix}multiqc.html`]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('keeps the marker row when the delete budget truncates the prefix', async () => {
    process.env.MAX_DELETES_PER_LAB_SWEEP = '1';
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([`${outputPrefix}a.bam`, `${outputPrefix}b.bam`]);

    await handler(event, ctx, jest.fn());

    const deleted = mockDeleteObjects.mock.calls[0][0].Delete.Objects.map((o: { Key: string }) => o.Key);
    expect(deleted).toEqual([`${outputPrefix}a.bam`]);
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('keeps the marker row when S3 reports a per-key delete failure', async () => {
    // Stamping CompletedAt here would orphan the surviving object permanently: the row is never
    // re-swept and reconciliation skips folders that already have a marker.
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([`${outputPrefix}a.bam`, `${outputPrefix}b.bam`]);
    mockDeleteObjects.mockResolvedValueOnce({
      Errors: [{ Key: `${outputPrefix}b.bam`, Code: 'AccessDenied', Message: 'Access Denied' }],
    });

    await handler(event, ctx, jest.fn());

    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('splits a listing larger than the S3 1000-key limit into multiple delete requests', async () => {
    const keys = Array.from({ length: 1500 }, (_, i) => `${outputPrefix}part-${i}.bam`);
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce(keys);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).toHaveBeenCalledTimes(2);
    expect(mockDeleteObjects.mock.calls[0][0].Delete.Objects).toHaveLength(1000);
    expect(mockDeleteObjects.mock.calls[1][0].Delete.Objects).toHaveLength(500);
    expect(mockMarkExpiredRunOutputCompleted).toHaveBeenCalledWith('lab-1', 'run-1');
  });

  it('leaves a Permanent-tagged object under results/ in place while deleting the rest', async () => {
    const permanentTagId = permanentTagIdForLaboratory(lab.LaboratoryId);
    const keptKey = `${outputPrefix}keep-me.bam`;
    mockListFileRows.mockResolvedValue([{ Ref: 'r-keep', ObjectKey: keptKey, TagIds: [permanentTagId] }]);
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([keptKey, `${outputPrefix}drop-me.bam`]);

    await handler(event, ctx, jest.fn());

    const deleted = mockDeleteObjects.mock.calls[0][0].Delete.Objects.map((o: { Key: string }) => o.Key);
    expect(deleted).toEqual([`${outputPrefix}drop-me.bam`]);
    // Everything deletable drained, so the marker retires even though a protected object remains.
    expect(mockMarkExpiredRunOutputCompleted).toHaveBeenCalledWith('lab-1', 'run-1');
  });

  it('removes the FILE# row of a tracked object it deletes, so no row is left dangling', async () => {
    const trackedKey = `${outputPrefix}tracked.bam`;
    mockListFileRows.mockResolvedValue([{ Ref: 'r-tracked', ObjectKey: trackedKey, TagIds: [] }]);
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([trackedKey]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteRow).toHaveBeenCalledWith('lab-1', 'r-tracked');
  });

  it('skips markers whose recorded keys fall outside the laboratory prefix', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([
      { ...marker, OutputPrefix: 'org-2/lab-9/aws-healthomics/run-1/results/', SampleSheetKeys: undefined },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockMarkExpiredRunOutputCompleted).not.toHaveBeenCalled();
  });

  it('refuses a marker whose prefix is the run folder root, where the input files live', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([
      { ...marker, OutputPrefix: `${runFolder}/`, SampleSheetKeys: undefined },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockListAllObjectKeysUnderPrefix).not.toHaveBeenCalled();
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it("refuses a marker whose prefix belongs to a different run's folder", async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([
      { ...marker, OutputPrefix: 'org-1/lab-1/aws-healthomics/run-9/results/', SampleSheetKeys: undefined },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it('removes the marker row when the run folder is already empty', async () => {
    mockListExpiredRunOutputs.mockResolvedValueOnce([{ ...marker, SampleSheetKeys: undefined }]);
    mockListAllObjectKeysUnderPrefix.mockResolvedValueOnce([]);

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
  const EXPIRED_RUN_ID = '11111111-2222-4333-8444-555555555555';
  const LIVE_RUN_ID = '99999999-8888-4777-8666-555555555555';

  const labPrefix = 'org-1/lab-1/';
  const platformPrefix = `${labPrefix}aws-healthomics/`;
  const runFolder = `${platformPrefix}${EXPIRED_RUN_ID}/`;

  const OLD = new Date('2020-01-01T00:00:00.000Z');
  const NOW = new Date();

  /**
   * The pass walks child prefixes, then lists objects under each run folder. Route each call by
   * its prefix so tests describe a bucket layout rather than a call sequence.
   */
  function mockBucket(layout: {
    prefixes?: Record<string, string[]>;
    objects?: Record<string, Array<{ Key: string; LastModified?: Date }>>;
  }): void {
    mockListChildPrefixes.mockImplementation(
      async (_bucket: string, prefix: string) => layout.prefixes?.[prefix] || [],
    );
    mockListAllObjectsUnderPrefix.mockImplementation(
      async (_bucket: string, prefix: string) => layout.objects?.[prefix] || [],
    );
  }

  beforeEach(() => {
    resetMocks();
    process.env.OUTPUT_DELETION_ENABLED = 'false';
    mockListChildPrefixes.mockReset();
    mockListAllObjectsUnderPrefix.mockReset();
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
    mockListAllRunsForLaboratory.mockResolvedValue([{ RunId: LIVE_RUN_ID }]);
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [liveFolder] },
      objects: { [liveFolder]: [{ Key: `${liveFolder}results/out.bam`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
  });

  it('does not scan the bucket at all when the surviving-run set cannot be loaded', async () => {
    mockListAllRunsForLaboratory.mockRejectedValueOnce(new Error('DynamoDB throttled'));
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}results/out.bam`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    expect(mockListChildPrefixes).not.toHaveBeenCalled();
    expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
  });

  it('does nothing at all while ORPHAN_RECONCILIATION_ENABLED is off', async () => {
    process.env.ORPHAN_RECONCILIATION_ENABLED = 'false';
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}results/out.bam`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    expect(mockListChildPrefixes).not.toHaveBeenCalled();
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

  it('applies a fixed 30-day quiet period', async () => {
    const justInside = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}results/a.bam`, LastModified: justInside }] },
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
    mockListFileRows.mockResolvedValue([{ Ref: 'r1', ObjectKey: `${runFolder}results/out.bam`, TagIds: [] }]);
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

  it('does not record a sample sheet that a surviving run still points at', async () => {
    mockListAllRunsForLaboratory.mockResolvedValue([
      { RunId: LIVE_RUN_ID, SampleSheetS3Url: `s3://my-bucket/${runFolder}samplesheet.csv` },
    ]);
    mockBucket({
      prefixes: { [labPrefix]: [platformPrefix], [platformPrefix]: [runFolder] },
      objects: { [runFolder]: [{ Key: `${runFolder}samplesheet.csv`, LastModified: OLD }] },
    });

    await handler(event, ctx, jest.fn());

    const recorded = mockRecordExpiredRunOutput.mock.calls[0][1];
    expect(recorded.SampleSheetKeys).toBeUndefined();
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
});
