process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';

const mockRemove: jest.Mock = jest.fn().mockResolvedValue(undefined);
const mockQueryByLaboratoryId: jest.Mock = jest.fn();
const mockRecordExpiredRunOutput: jest.Mock = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    queryByLaboratoryId: mockQueryByLaboratoryId,
  })),
}));

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service', () => ({
  LaboratoryDataTaggingService: jest.fn().mockImplementation(() => ({
    removeLaboratoryRunUsageForRunIds: mockRemove,
    recordExpiredRunOutput: mockRecordExpiredRunOutput,
  })),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-laboratory-run-stream.lambda';

function buildEvent(
  records: Array<{
    eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
    oldImage?: Record<string, unknown>;
    principalId?: string;
  }>,
): DynamoDBStreamEvent {
  return {
    Records: records.map((r, idx) => ({
      eventID: `evt-${idx}`,
      eventName: r.eventName,
      eventSource: 'aws:dynamodb',
      dynamodb: {
        OldImage: r.oldImage ? (marshall(r.oldImage, { removeUndefinedValues: true }) as any) : undefined,
      },
      userIdentity: r.principalId ? { principalId: r.principalId, type: 'Service' } : undefined,
    })),
  } as DynamoDBStreamEvent;
}

const ctx = {} as Context;

describe('process-laboratory-run-stream.lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockResolvedValue(undefined);
    mockRecordExpiredRunOutput.mockReset().mockResolvedValue(undefined);
    mockQueryByLaboratoryId.mockReset().mockResolvedValue({
      LaboratoryId: 'lab-1',
      OrganizationId: 'org-1',
      S3Bucket: 'my-bucket',
    });
  });

  it('removes per-file run usage entries on REMOVE events with preserveEmptyFileRow', async () => {
    const event = buildEvent([
      {
        eventName: 'REMOVE',
        oldImage: {
          LaboratoryId: 'lab-1',
          RunId: 'run-1',
          InputFileKeys: ['org-1/lab-1/a.fq.gz', 'org-1/lab-1/b.fq.gz'],
        },
      },
    ]);

    await handler(event, ctx, jest.fn());

    expect(mockRemove).toHaveBeenCalledTimes(1);
    const [, , runIdMap, options] = mockRemove.mock.calls[0];
    expect(runIdMap).toEqual({ 'run-1': ['org-1/lab-1/a.fq.gz', 'org-1/lab-1/b.fq.gz'] });
    expect(options).toEqual({ preserveEmptyFileRow: true });
  });

  it('logs TTL provenance when principalId === dynamodb.amazonaws.com', async () => {
    const event = buildEvent([
      {
        eventName: 'REMOVE',
        principalId: 'dynamodb.amazonaws.com',
        oldImage: {
          LaboratoryId: 'lab-1',
          RunId: 'run-2',
          InputFileKeys: ['org-1/lab-1/c.fq.gz'],
        },
      },
    ]);

    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await handler(event, ctx, jest.fn());
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('TTL'));
    consoleLogSpy.mockRestore();
  });

  it('ignores INSERT and MODIFY records', async () => {
    const event = buildEvent([
      { eventName: 'INSERT', oldImage: undefined },
      { eventName: 'MODIFY', oldImage: { LaboratoryId: 'lab-1', RunId: 'run-3' } },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('skips REMOVE records that lack LaboratoryId or RunId in OldImage', async () => {
    const event = buildEvent([
      { eventName: 'REMOVE', oldImage: { InputFileKeys: ['org-1/lab-1/a.fq.gz'] } },
      { eventName: 'REMOVE', oldImage: { LaboratoryId: 'lab-1' } },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('skips per-file unlinking when InputFileKeys is empty', async () => {
    const event = buildEvent([
      { eventName: 'REMOVE', oldImage: { LaboratoryId: 'lab-1', RunId: 'run-4', InputFileKeys: [] } },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('skips when the laboratory row is missing (LaboratoryNotFoundError) without throwing', async () => {
    mockQueryByLaboratoryId.mockRejectedValueOnce(new LaboratoryNotFoundError());
    const event = buildEvent([
      {
        eventName: 'REMOVE',
        oldImage: { LaboratoryId: 'lab-1', RunId: 'run-5', InputFileKeys: ['org-1/lab-1/a.fq.gz'] },
      },
    ]);
    await expect(handler(event, ctx, jest.fn())).resolves.toBeUndefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('rethrows when loading the laboratory fails for a non-404 reason', async () => {
    mockQueryByLaboratoryId.mockRejectedValueOnce(new Error('lab gone'));
    const event = buildEvent([
      {
        eventName: 'REMOVE',
        oldImage: { LaboratoryId: 'lab-1', RunId: 'run-5', InputFileKeys: ['org-1/lab-1/a.fq.gz'] },
      },
    ]);
    await expect(handler(event, ctx, jest.fn())).rejects.toThrow(/lab gone/);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('rethrows errors from the tagging service so the event source can retry / DLQ', async () => {
    mockRemove.mockRejectedValueOnce(new Error('ddb explode'));
    const event = buildEvent([
      {
        eventName: 'REMOVE',
        oldImage: { LaboratoryId: 'lab-1', RunId: 'run-6', InputFileKeys: ['org-1/lab-1/a.fq.gz'] },
      },
    ]);
    await expect(handler(event, ctx, jest.fn())).rejects.toThrow(/ddb explode/);
  });

  describe('expired run output bookkeeping', () => {
    const runFolder = 'org-1/lab-1/aws-healthomics/run-7';

    it('records the output prefix and sample sheet so the sweep can delete them', async () => {
      const event = buildEvent([
        {
          eventName: 'REMOVE',
          oldImage: {
            LaboratoryId: 'lab-1',
            RunId: 'run-7',
            InputFileKeys: [],
            OutputS3Url: `s3://my-bucket/${runFolder}/results`,
            SampleSheetS3Url: `s3://my-bucket/${runFolder}/samplesheet.csv`,
          },
        },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRecordExpiredRunOutput).toHaveBeenCalledWith('lab-1', {
        RunId: 'run-7',
        S3Bucket: 'my-bucket',
        OutputPrefix: `${runFolder}/results/`,
        SampleSheetKeys: [`${runFolder}/samplesheet.csv`],
        RecordedAt: expect.any(String),
      });
    });

    it('records outputs alongside the per-file unlinking when the run had inputs', async () => {
      const event = buildEvent([
        {
          eventName: 'REMOVE',
          oldImage: {
            LaboratoryId: 'lab-1',
            RunId: 'run-7',
            InputFileKeys: ['org-1/lab-1/a.fq.gz'],
            OutputS3Url: `s3://my-bucket/${runFolder}/results`,
          },
        },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRecordExpiredRunOutput).toHaveBeenCalledTimes(1);
    });

    it('percent-decodes keys so sample sheet names containing spaces survive the round trip', async () => {
      const event = buildEvent([
        {
          eventName: 'REMOVE',
          oldImage: {
            LaboratoryId: 'lab-1',
            RunId: 'run-7',
            InputFileKeys: [],
            SampleSheetS3Url: `s3://my-bucket/${runFolder}/my run sheet.csv`,
          },
        },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRecordExpiredRunOutput).toHaveBeenCalledWith(
        'lab-1',
        expect.objectContaining({ SampleSheetKeys: [`${runFolder}/my run sheet.csv`] }),
      );
    });

    it('does not record a custom outdir that points outside the run folder', async () => {
      const event = buildEvent([
        {
          eventName: 'REMOVE',
          oldImage: {
            LaboratoryId: 'lab-1',
            RunId: 'run-7',
            InputFileKeys: [],
            OutputS3Url: 's3://my-bucket/org-1/lab-1/shared-results',
          },
        },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
    });

    it('does not record an outdir pointing at the run folder root, where the input files live', async () => {
      // `outdir` is user-editable, and prefix deletion is recursive: recording the root would let
      // the sweep delete the run's FASTQ inputs, bypassing the FILE#-row and Permanent-tag rules.
      const event = buildEvent([
        {
          eventName: 'REMOVE',
          oldImage: {
            LaboratoryId: 'lab-1',
            RunId: 'run-7',
            InputFileKeys: [],
            OutputS3Url: `s3://my-bucket/${runFolder}`,
          },
        },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
    });

    it('records a custom outdir that is a subdirectory of the run folder', async () => {
      const event = buildEvent([
        {
          eventName: 'REMOVE',
          oldImage: {
            LaboratoryId: 'lab-1',
            RunId: 'run-7',
            InputFileKeys: [],
            OutputS3Url: `s3://my-bucket/${runFolder}/custom-outdir`,
          },
        },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRecordExpiredRunOutput).toHaveBeenCalledWith(
        'lab-1',
        expect.objectContaining({ OutputPrefix: `${runFolder}/custom-outdir/` }),
      );
    });

    it('does not record outputs living in a different bucket', async () => {
      const event = buildEvent([
        {
          eventName: 'REMOVE',
          oldImage: {
            LaboratoryId: 'lab-1',
            RunId: 'run-7',
            InputFileKeys: [],
            OutputS3Url: `s3://other-bucket/${runFolder}/results`,
          },
        },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
    });

    it('records nothing when the run has no output or sample sheet locations', async () => {
      const event = buildEvent([
        { eventName: 'REMOVE', oldImage: { LaboratoryId: 'lab-1', RunId: 'run-7', InputFileKeys: [] } },
      ]);

      await handler(event, ctx, jest.fn());

      expect(mockRecordExpiredRunOutput).not.toHaveBeenCalled();
    });
  });
});
