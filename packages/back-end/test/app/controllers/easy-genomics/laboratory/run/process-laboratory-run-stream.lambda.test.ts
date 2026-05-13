process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';

const mockRemove: jest.Mock = jest.fn().mockResolvedValue(undefined);
const mockQueryByLaboratoryId: jest.Mock = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    queryByLaboratoryId: mockQueryByLaboratoryId,
  })),
}));

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-data-tagging-service', () => ({
  LaboratoryDataTaggingService: jest.fn().mockImplementation(() => ({
    removeLaboratoryRunUsageForRunIds: mockRemove,
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

  it('skips REMOVE records with empty InputFileKeys without calling the tagging service', async () => {
    const event = buildEvent([
      { eventName: 'REMOVE', oldImage: { LaboratoryId: 'lab-1', RunId: 'run-4', InputFileKeys: [] } },
    ]);
    await handler(event, ctx, jest.fn());
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('skips when the lab cannot be loaded (no throw)', async () => {
    mockQueryByLaboratoryId.mockRejectedValueOnce(new Error('lab gone'));
    const event = buildEvent([
      {
        eventName: 'REMOVE',
        oldImage: { LaboratoryId: 'lab-1', RunId: 'run-5', InputFileKeys: ['org-1/lab-1/a.fq.gz'] },
      },
    ]);
    await expect(handler(event, ctx, jest.fn())).resolves.toBeUndefined();
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
});
