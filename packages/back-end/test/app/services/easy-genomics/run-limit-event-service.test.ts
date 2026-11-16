process.env.NAME_PREFIX = 'unit-test';

import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  RunLimitEventService,
  blockedAttemptId,
  runLimitEventKey,
} from '../../../../src/app/services/easy-genomics/run-limit-event-service';

const ORGANIZATION_ID = 'org-1';

const blockedEvent = {
  OrganizationId: ORGANIZATION_ID,
  EventId: 'attempt-1',
  Kind: 'blocked' as const,
  OccurredAt: '2026-11-13T10:15:30.000Z',
  LaboratoryId: 'lab-1',
  Platform: 'AWS HealthOmics' as const,
  WorkflowExternalId: '1234567',
  UserId: 'user-1',
  UserEmail: 'tester@example.com',
  Source: 'review' as const,
  Reason: 'limitExceeded' as const,
  Hits: [],
};

function transactionCanceled(...codes: string[]): TransactionCanceledException {
  return new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

describe('runLimitEventKey', () => {
  it('puts the kind first, so one kind over a period is a single key range', () => {
    expect(runLimitEventKey('blocked', '2026-11-13', 'abc')).toBe('blocked#2026-11-13#abc');
  });
});

describe('blockedAttemptId', () => {
  const attempt = {
    laboratoryId: 'lab-1',
    platform: 'AWS HealthOmics' as const,
    workflowExternalId: '1234567',
    userId: 'user-1',
    sampleSheetS3Url: 's3://bucket/sheet.csv',
    source: 'review' as const,
  };

  it('is stable for the same user, lab, workflow, sheet and source, and differs by user, sheet or source', () => {
    const id = blockedAttemptId(attempt);

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(blockedAttemptId({ ...attempt })).toBe(id);
    expect(blockedAttemptId({ ...attempt, userId: 'user-2' })).not.toBe(id);
    expect(blockedAttemptId({ ...attempt, sampleSheetS3Url: 's3://bucket/other.csv' })).not.toBe(id);
    expect(blockedAttemptId({ ...attempt, source: 'launch' })).not.toBe(id);
  });

  it('gives a sheetless block a stable id', () => {
    const sheetless = { ...attempt };
    delete (sheetless as { sampleSheetS3Url?: string }).sampleSheetS3Url;

    expect(blockedAttemptId(sheetless)).toBe(blockedAttemptId({ ...sheetless, sampleSheetS3Url: undefined }));
    expect(blockedAttemptId(sheetless)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('RunLimitEventService', () => {
  let service: RunLimitEventService;
  let transactWriteItems: jest.Mock;
  let queryItems: jest.Mock;
  let getItem: jest.Mock;

  beforeEach(() => {
    service = new RunLimitEventService();
    transactWriteItems = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    queryItems = jest.fn();
    getItem = jest.fn().mockResolvedValue({});
    (service as unknown as { getItem: jest.Mock }).getItem = getItem;
    (service as unknown as { transactWriteItems: jest.Mock }).transactWriteItems = transactWriteItems;
    (service as unknown as { queryItems: jest.Mock }).queryItems = queryItems;
  });

  afterEach(() => jest.restoreAllMocks());

  it('targets the name-prefixed table', () => {
    expect(service.RUN_LIMIT_EVENT_TABLE_NAME).toBe('unit-test-run-limit-event-table');
  });

  describe('record', () => {
    it("puts the event and adds one to the day's count in one transaction", async () => {
      await expect(service.record(blockedEvent)).resolves.toBe('recorded');

      const items = transactWriteItems.mock.calls[0][0].TransactItems;
      expect(items).toHaveLength(2);
      expect(items[0].Put).toMatchObject({
        TableName: 'unit-test-run-limit-event-table',
        ConditionExpression: 'attribute_not_exists(EventKey)',
      });
      const stored = unmarshall(items[0].Put.Item);
      expect(stored).toMatchObject({
        OrganizationId: ORGANIZATION_ID,
        EventKey: 'blocked#2026-11-13#attempt-1',
        Day: '2026-11-13',
        Kind: 'blocked',
        UserId: 'user-1',
      });
      expect(stored.EventId).toBeUndefined();
      expect(stored.ExpiresAt).toBe(Date.parse('2026-11-13T10:15:30.000Z') / 1000 + 396 * 24 * 60 * 60);
      expect(items[1].Update).toMatchObject({
        TableName: 'unit-test-usage-daily-total-table',
        Key: {
          OrganizationId: { S: ORGANIZATION_ID },
          DayLabWorkflow: { S: '2026-11-13#lab-1#AWS HealthOmics#1234567' },
        },
      });
      expect(items[1].Update.UpdateExpression).toContain('ADD #BlockedLaunches :one');
      expect(unmarshall(items[1].Update.ExpressionAttributeValues)[':one']).toBe(1);
    });

    it('adds a warned event to WarnedRuns', async () => {
      await service.record({ ...blockedEvent, Kind: 'warned', Reason: undefined });

      const update = transactWriteItems.mock.calls[0][0].TransactItems[1].Update;
      expect(update.UpdateExpression).toContain('ADD #WarnedRuns :one');
    });

    it('returns already-recorded without a transaction when the event is already stored', async () => {
      getItem.mockResolvedValue({ Item: marshall({ OrganizationId: ORGANIZATION_ID, EventKey: 'k' }) });

      await expect(service.record(blockedEvent)).resolves.toBe('already-recorded');

      expect(getItem).toHaveBeenCalledWith({
        TableName: 'unit-test-run-limit-event-table',
        Key: marshall({ OrganizationId: ORGANIZATION_ID, EventKey: 'blocked#2026-11-13#attempt-1' }),
        ProjectionExpression: 'EventKey',
      });
      expect(transactWriteItems).not.toHaveBeenCalled();
    });

    it("returns already-recorded and counts nothing when item 0's condition fails", async () => {
      transactWriteItems.mockRejectedValue(transactionCanceled('ConditionalCheckFailed', 'None'));

      await expect(service.record(blockedEvent)).resolves.toBe('already-recorded');
    });

    it('throws any other transaction error', async () => {
      const throttled = transactionCanceled('None', 'ThrottlingError');
      transactWriteItems.mockRejectedValue(throttled);

      await expect(service.record(blockedEvent)).rejects.toBe(throttled);
    });
  });

  describe('listForPeriod', () => {
    const eventAt = (hour: number, day: string = '2026-11-13') =>
      marshall({
        OrganizationId: ORGANIZATION_ID,
        EventKey: `blocked#${day}#e${hour}`,
        Day: day,
        Kind: 'blocked',
        OccurredAt: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`,
      });

    it('returns the newest events up to the limit and says it truncated', async () => {
      queryItems.mockResolvedValue({ Items: [eventAt(8), eventAt(10), eventAt(9)] });

      const result = await service.listForPeriod(ORGANIZATION_ID, '2026-11-01', '2026-11-30', 'blocked', 2);

      expect(result.truncated).toBe(true);
      expect(result.events.map((event) => event.EventKey)).toEqual(['blocked#2026-11-13#e10', 'blocked#2026-11-13#e9']);
      expect(queryItems.mock.calls[0][0]).toMatchObject({ TableName: 'unit-test-run-limit-event-table' });
      expect(queryItems.mock.calls[0][0].FilterExpression).toBeUndefined();
      expect(unmarshall(queryItems.mock.calls[0][0].ExpressionAttributeValues)).toEqual({
        ':organizationId': ORGANIZATION_ID,
        ':start': 'blocked#2026-11-01',
        ':end': 'blocked#2026-11-30#￿',
      });
    });

    it('pages through LastEvaluatedKey', async () => {
      const lastKey = { OrganizationId: { S: ORGANIZATION_ID }, EventKey: { S: 'k' } };
      queryItems
        .mockResolvedValueOnce({ Items: [eventAt(8)], LastEvaluatedKey: lastKey })
        .mockResolvedValueOnce({ Items: [eventAt(9)] });

      const result = await service.listForPeriod(ORGANIZATION_ID, '2026-11-01', '2026-11-30', 'blocked');

      expect(result.events).toHaveLength(2);
      expect(result.truncated).toBe(false);
      expect(queryItems.mock.calls[1][0].ExclusiveStartKey).toEqual(lastKey);
    });

    it('finishes the day the limit falls in, since keys within a day are not in time order', async () => {
      const lastKey = { OrganizationId: { S: ORGANIZATION_ID }, EventKey: { S: 'k' } };
      queryItems
        .mockResolvedValueOnce({ Items: [eventAt(8), eventAt(10), eventAt(9)], LastEvaluatedKey: lastKey })
        .mockResolvedValueOnce({ Items: [eventAt(23), eventAt(5, '2026-11-12')], LastEvaluatedKey: lastKey });

      const result = await service.listForPeriod(ORGANIZATION_ID, '2026-11-01', '2026-11-30', 'blocked', 2);

      expect(result.events.map((event) => event.EventKey)).toEqual(['blocked#2026-11-13#e23', 'blocked#2026-11-13#e10']);
      expect(result.truncated).toBe(true);
      expect(queryItems).toHaveBeenCalledTimes(2);
    });

    it('returns nothing, without failing, for a limit of 0', async () => {
      queryItems.mockResolvedValue({ Items: [eventAt(8)] });

      const result = await service.listForPeriod(ORGANIZATION_ID, '2026-11-01', '2026-11-30', 'blocked', 0);

      expect(result).toEqual({ events: [], truncated: true });
    });
  });
});
