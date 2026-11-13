process.env.NAME_PREFIX = 'unit-test';

import { LaboratoryStorageSummary } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { permanentTagIdForLaboratory } from '../../../../src/app/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryStorageService } from '../../../../src/app/services/easy-genomics/laboratory-storage-service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const ORPHAN = '33333333-3333-4333-8333-333333333333';
const LAB = `${ORG_ID}/${LAB_ID}/`;
const BUCKET = 'lab-bucket';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

const laboratory = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, S3Bucket: BUCKET } as Laboratory;

const run = (overrides: Partial<LaboratoryRun>): LaboratoryRun =>
  ({
    LaboratoryId: LAB_ID,
    OrganizationId: ORG_ID,
    RunName: 'run',
    Status: 'COMPLETED',
    WorkflowName: 'viralrecon',
    ...overrides,
  }) as LaboratoryRun;

function setup(opts: {
  objects: Array<{ Key: string; Size: number; LastModified: Date }>;
  runs: LaboratoryRun[];
  fileRows?: Array<{ ObjectKey: string; TagIds?: string[]; SampleIds?: string[] }>;
}) {
  let stored: LaboratoryStorageSummary | undefined;
  const s3Service = {
    listBucketObjectsV2: jest.fn().mockResolvedValue({ Contents: opts.objects, IsTruncated: false }),
    deleteObjects: jest.fn().mockResolvedValue({ Errors: [] }),
    getBucketLocation: jest.fn().mockResolvedValue({ LocationConstraint: 'us-west-2' }),
  };
  const taggingService = {
    listAllFileRowsForLab: jest.fn().mockResolvedValue(
      (opts.fileRows ?? []).map((row) => ({ Ref: `ref:${row.ObjectKey}`, S3Bucket: BUCKET, TagIds: [], ...row })),
    ),
    listPermanentSampleIds: jest.fn().mockResolvedValue(new Set()),
    putStorageSummary: jest.fn(async (summary: LaboratoryStorageSummary) => {
      stored = summary;
    }),
    getStorageSummary: jest.fn(async () => stored ?? null),
    assertLaboratoryHasS3BucketAccess: jest.fn().mockResolvedValue([]),
    assertKeyUnderLabPrefix: jest.fn(),
    deleteFileRowAndAssociations: jest.fn().mockResolvedValue(undefined),
    ensurePermanentTag: jest.fn().mockResolvedValue({ TagId: permanentTagIdForLaboratory(LAB_ID) }),
    applyTagsToFiles: jest.fn().mockResolvedValue(undefined),
  };
  const runService = { listAllRunsForLaboratory: jest.fn().mockResolvedValue(opts.runs) };
  const pricingService = { getS3StandardPricePerGbMonth: jest.fn().mockResolvedValue(0.023) };

  const service = new LaboratoryStorageService({
    s3Service: s3Service as any,
    taggingService: taggingService as any,
    runService: runService as any,
    pricingService: pricingService as any,
  });
  return { service, s3Service, taggingService, pricingService };
}

describe('LaboratoryStorageService', () => {
  const runA = run({
    RunId: RUN_A,
    RunName: 'sc2-batch-0918',
    InputFileKeys: [`${LAB}aws-healthomics/${RUN_A}/s1_R1.fastq.gz`],
    SampleSheetS3Url: `s3://${BUCKET}/${LAB}aws-healthomics/${RUN_A}/samplesheet.csv`,
    OutputS3Url: `s3://${BUCKET}/${LAB}aws-healthomics/${RUN_A}/results`,
    RunInputProfile: { SampleCount: 48 } as LaboratoryRun['RunInputProfile'],
  });

  const objects = [
    { Key: `${LAB}aws-healthomics/${RUN_A}/s1_R1.fastq.gz`, Size: 100, LastModified: daysAgo(3) },
    { Key: `${LAB}aws-healthomics/${RUN_A}/samplesheet.csv`, Size: 10, LastModified: daysAgo(3) },
    { Key: `${LAB}aws-healthomics/${RUN_A}/results/report.html`, Size: 1000, LastModified: daysAgo(2) },
    { Key: `${LAB}aws-healthomics/${ORPHAN}/results/old.bam`, Size: 5000, LastModified: daysAgo(200) },
    { Key: `${LAB}uploads/2025-11-ingest/a.fastq.gz`, Size: 7000, LastModified: daysAgo(5) },
  ];

  it('groups objects by run and totals attached versus unattached bytes', async () => {
    const { service, pricingService } = setup({ objects, runs: [runA] });

    const summary = await service.rescan(laboratory);
    const byId = Object.fromEntries(summary.Items.map((item) => [item.ItemId, item]));

    expect(byId[`InputData#${RUN_A}`]).toEqual(
      expect.objectContaining({ Name: 'sc2-batch-0918 reads', Detail: '48 samples', SizeBytes: 100 }),
    );
    expect(byId[`SampleSheet#${RUN_A}`]).toEqual(expect.objectContaining({ Name: 'samplesheet.csv', SizeBytes: 10 }));
    expect(byId[`RunOutputs#${RUN_A}`]).toEqual(
      expect.objectContaining({ Path: `aws-healthomics/${RUN_A}/results/`, Status: 'Active', Deletable: true }),
    );
    expect(byId[`Unattached#aws-healthomics/${ORPHAN}/`]).toEqual(
      expect.objectContaining({ Status: 'NoRunRecord', Deletable: true, SizeBytes: 5000 }),
    );
    // Recent data with no run is usually an upload whose run has not launched yet.
    expect(byId['Unattached#uploads/2025-11-ingest/']).toEqual(expect.objectContaining({ Deletable: false }));

    expect(summary).toEqual(
      expect.objectContaining({
        TotalBytes: 13110,
        AttachedBytes: 1110,
        NoRunRecordBytes: 12000,
        NoRunRecordFileCount: 2,
        RunCount: 1,
        PricePerGbMonthUsd: 0.023,
      }),
    );
    expect(pricingService.getS3StandardPricePerGbMonth).toHaveBeenCalledWith('us-west-2');
  });

  it('marks a running run as not deletable', async () => {
    const { service } = setup({ objects, runs: [{ ...runA, Status: 'RUNNING' }] });

    const summary = await service.rescan(laboratory);

    expect(summary.Items.find((i) => i.ItemId === `RunOutputs#${RUN_A}`)).toEqual(
      expect.objectContaining({ Status: 'Running', Deletable: false }),
    );
  });

  it('skips protected, sample-linked and shared keys when deleting', async () => {
    const permanentTagId = permanentTagIdForLaboratory(LAB_ID);
    const sharedInput = `${LAB}aws-healthomics/${RUN_A}/shared_R1.fastq.gz`;
    const runB = run({ RunId: RUN_B, RunName: 'retry', InputFileKeys: [sharedInput] });
    const { service, s3Service, taggingService } = setup({
      objects: [
        { Key: `${LAB}aws-healthomics/${RUN_A}/results/keep.bam`, Size: 1, LastModified: daysAgo(40) },
        { Key: `${LAB}aws-healthomics/${RUN_A}/results/linked.bam`, Size: 1, LastModified: daysAgo(40) },
        { Key: `${LAB}aws-healthomics/${RUN_A}/results/drop.bam`, Size: 1, LastModified: daysAgo(40) },
        { Key: sharedInput, Size: 1, LastModified: daysAgo(40) },
      ],
      runs: [{ ...runA, InputFileKeys: [sharedInput] }, runB],
      fileRows: [
        { ObjectKey: `${LAB}aws-healthomics/${RUN_A}/results/keep.bam`, TagIds: [permanentTagId] },
        { ObjectKey: `${LAB}aws-healthomics/${RUN_A}/results/linked.bam`, SampleIds: ['sample-1'] },
      ],
    });

    const result = await service.removeItems(laboratory, [`RunOutputs#${RUN_A}`, `InputData#${RUN_A}`]);

    expect(s3Service.deleteObjects).toHaveBeenCalledTimes(1);
    expect(s3Service.deleteObjects.mock.calls[0][0].Delete.Objects).toEqual([
      { Key: `${LAB}aws-healthomics/${RUN_A}/results/drop.bam` },
    ]);
    expect(result.DeletedObjectCount).toBe(1);
    expect(result.SkippedObjectCount).toBe(3);
    expect(taggingService.assertLaboratoryHasS3BucketAccess).toHaveBeenCalledWith(laboratory, BUCKET);
    expect(result.Summary.Items.find((i) => i.ItemId === `RunOutputs#${RUN_A}`)?.FileCount).toBe(2);
  });

  it('refuses to delete recent data with no run record', async () => {
    const { service, s3Service } = setup({ objects, runs: [runA] });

    const result = await service.removeItems(laboratory, ['Unattached#uploads/2025-11-ingest/']);

    expect(s3Service.deleteObjects).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ DeletedObjectCount: 0, SkippedObjectCount: 1 }));
  });

  it('rejects an item id that is no longer in the bucket', async () => {
    const { service } = setup({ objects, runs: [runA] });

    await expect(service.removeItems(laboratory, ['RunOutputs#gone'])).rejects.toThrow(/no longer exists/);
  });

  it('applies the Permanent tag to every file of the selected items', async () => {
    const { service, taggingService } = setup({ objects, runs: [runA] });
    const permanentTagId = permanentTagIdForLaboratory(LAB_ID);

    await service.setProtection(laboratory, [`RunOutputs#${RUN_A}`], true, 'user-1');

    expect(taggingService.applyTagsToFiles).toHaveBeenCalledWith(
      laboratory,
      'user-1',
      BUCKET,
      [`${LAB}aws-healthomics/${RUN_A}/results/report.html`],
      [permanentTagId],
      [],
    );
  });

  it('stops an interactive scan that runs past its budget', async () => {
    const { service, s3Service } = setup({ objects, runs: [runA] });
    s3Service.listBucketObjectsV2.mockResolvedValue({ Contents: [], IsTruncated: true, NextContinuationToken: 't' });

    await expect(service.rescan(laboratory, 0)).rejects.toThrow(/too many files/);
  });
});
