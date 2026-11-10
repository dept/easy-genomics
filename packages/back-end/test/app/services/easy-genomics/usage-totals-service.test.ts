process.env.NAME_PREFIX = 'unit-test';

import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { UsageTotalsService, usageTotalKey } from '../../../../src/app/services/easy-genomics/usage-totals-service';

const ORGANIZATION_ID = 'org-1';
const LABORATORY_ID = 'lab-1';

function runFixture(overrides?: Partial<LaboratoryRun>): LaboratoryRun {
  return {
    LaboratoryId: LABORATORY_ID,
    RunId: 'run-1',
    UserId: 'user-1',
    OrganizationId: ORGANIZATION_ID,
    RunName: 'run',
    Platform: 'AWS HealthOmics',
    Status: 'COMPLETED',
    Owner: 'tester@example.com',
    WorkflowName: 'nf-core/viralrecon',
    WorkflowExternalId: '1234567',
    TerminalAt: '2026-11-09T23:59:30.000Z',
    RunCostOutcome: {
      ActualComputeCostUsd: 12.5,
      ActualStorageCostUsd: 3.25,
      CostSource: 'HEALTHOMICS_TASKS',
      CostCapturedAt: '2026-11-10T00:01:00.000Z',
    },
    ...overrides,
  };
}

function transactionCanceled(...codes: string[]): TransactionCanceledException {
  return new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

describe('usageTotalKey', () => {
  it('joins day, lab, platform and workflow with #, so a day prefix sorts and ranges', () => {
    expect(usageTotalKey('2026-11-09', LABORATORY_ID, 'Seqera Cloud', 'pipeline-42')).toBe(
      '2026-11-09#lab-1#Seqera Cloud#pipeline-42',
    );
  });
});

describe('UsageTotalsService', () => {
  let service: UsageTotalsService;
  let transactWriteItems: jest.Mock;
  let queryItems: jest.Mock;
  let updateItem: jest.Mock;

  beforeEach(() => {
    service = new UsageTotalsService();
    transactWriteItems = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    queryItems = jest.fn();
    updateItem = jest.fn();
    (service as unknown as { updateItem: jest.Mock }).updateItem = updateItem;
    (service as unknown as { transactWriteItems: jest.Mock }).transactWriteItems = transactWriteItems;
    (service as unknown as { queryItems: jest.Mock }).queryItems = queryItems;
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('targets the name-prefixed tables', () => {
    expect(service.USAGE_DAILY_TOTAL_TABLE_NAME).toBe('unit-test-usage-daily-total-table');
    expect(service.LABORATORY_RUN_TABLE_NAME).toBe('unit-test-laboratory-run-table');
  });

  describe('addRunCost', () => {
    it.each([
      ['TerminalAt', runFixture({ TerminalAt: undefined })],
      ['RunCostOutcome.ActualComputeCostUsd', runFixture({ RunCostOutcome: undefined })],
      [
        'RunCostOutcome.ActualComputeCostUsd',
        runFixture({
          RunCostOutcome: { CostSource: 'SEQERA_PROGRESS', CostCapturedAt: '2026-11-10T00:01:00.000Z' },
        }),
      ],
      ['WorkflowExternalId', runFixture({ WorkflowExternalId: undefined })],
    ])('does not count a run with no %s, and writes nothing', async (field, run) => {
      await expect(service.addRunCost(run)).resolves.toBe('not-countable');

      expect(transactWriteItems).not.toHaveBeenCalled();
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('RunId=run-1'));
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining(field));
    });

    it('marks the run and adds its cost to the day in one transaction', async () => {
      await expect(service.addRunCost(runFixture())).resolves.toBe('counted');

      expect(transactWriteItems).toHaveBeenCalledTimes(1);
      const [markRun, addTotal] = transactWriteItems.mock.calls[0][0].TransactItems.map(
        (item: { Update: unknown }) => item.Update,
      );

      expect(markRun).toMatchObject({
        TableName: 'unit-test-laboratory-run-table',
        Key: { LaboratoryId: { S: LABORATORY_ID }, RunId: { S: 'run-1' } },
        UpdateExpression: 'SET #RunCostCountedAt = :now',
        ConditionExpression: 'attribute_not_exists(#RunCostCountedAt) AND attribute_exists(#RunId)',
        ExpressionAttributeNames: { '#RunCostCountedAt': 'RunCostCountedAt', '#RunId': 'RunId' },
      });

      expect(addTotal).toMatchObject({
        TableName: 'unit-test-usage-daily-total-table',
        Key: {
          OrganizationId: { S: ORGANIZATION_ID },
          DayLabWorkflow: { S: '2026-11-09#lab-1#AWS HealthOmics#1234567' },
        },
        UpdateExpression:
          'ADD #ComputeCostUsd :computeCostUsd, #StorageCostUsd :storageCostUsd, #FinishedRuns :one, ' +
          '#WarnedRuns :zero, #BlockedLaunches :zero ' +
          'SET #Day = :day, #LaboratoryId = :laboratoryId, #Platform = :platform, ' +
          '#WorkflowExternalId = :workflowExternalId, #ModifiedAt = :now, ' +
          '#WorkflowName = if_not_exists(#WorkflowName, :workflowName)',
      });
      expect(addTotal.ConditionExpression).toBeUndefined();
      expect(unmarshall(addTotal.ExpressionAttributeValues)).toEqual({
        ':computeCostUsd': 12.5,
        ':storageCostUsd': 3.25,
        ':one': 1,
        ':zero': 0,
        ':day': '2026-11-09',
        ':laboratoryId': LABORATORY_ID,
        ':platform': 'AWS HealthOmics',
        ':workflowExternalId': '1234567',
        ':workflowName': 'nf-core/viralrecon',
        ':now': expect.any(String),
      });
      expect(unmarshall(markRun.ExpressionAttributeValues)[':now']).toBe(
        unmarshall(addTotal.ExpressionAttributeValues)[':now'],
      );
    });

    it('adds zero storage when the platform reported none, and leaves WorkflowName alone when the run has none', async () => {
      const run = runFixture({ WorkflowName: undefined });
      run.RunCostOutcome = { ActualComputeCostUsd: 0.4, CostSource: 'SEQERA_PROGRESS', CostCapturedAt: 'x' };

      await expect(service.addRunCost(run)).resolves.toBe('counted');

      const addTotal = transactWriteItems.mock.calls[0][0].TransactItems[1].Update;
      expect(addTotal.UpdateExpression).not.toContain('WorkflowName');
      expect(addTotal.ExpressionAttributeNames['#WorkflowName']).toBeUndefined();
      expect(unmarshall(addTotal.ExpressionAttributeValues)).toMatchObject({
        ':computeCostUsd': 0.4,
        ':storageCostUsd': 0,
      });
    });

    it('reports already-counted when the run already carries the marker', async () => {
      transactWriteItems.mockRejectedValue(transactionCanceled('ConditionalCheckFailed', 'None'));

      await expect(service.addRunCost(runFixture())).resolves.toBe('already-counted');
    });

    it('rethrows any other cancellation, so SQS retries', async () => {
      const conflict = transactionCanceled('None', 'TransactionConflict');
      transactWriteItems.mockRejectedValue(conflict);

      await expect(service.addRunCost(runFixture())).rejects.toBe(conflict);
    });

    it('rethrows a non-transaction error', async () => {
      const throttled = new Error('Throttled');
      transactWriteItems.mockRejectedValue(throttled);

      await expect(service.addRunCost(runFixture())).rejects.toBe(throttled);
    });
  });

  describe('addLaunchCount', () => {
    const launch = {
      OrganizationId: ORGANIZATION_ID,
      LaboratoryId: LABORATORY_ID,
      Platform: 'Seqera Cloud' as const,
      WorkflowExternalId: 'pipeline-42',
      Day: '2026-11-10',
    };

    it.each([
      ['warned', '#WarnedRuns', '#BlockedLaunches'],
      ['blocked', '#BlockedLaunches', '#WarnedRuns'],
    ] as const)('adds one %s launch to the day with a single unconditional update', async (kind, counted, other) => {
      updateItem.mockResolvedValue({});

      await service.addLaunchCount({ ...launch, Kind: kind });

      expect(updateItem).toHaveBeenCalledTimes(1);
      const update = updateItem.mock.calls[0][0];
      expect(update).toMatchObject({
        TableName: 'unit-test-usage-daily-total-table',
        Key: {
          OrganizationId: { S: ORGANIZATION_ID },
          DayLabWorkflow: { S: '2026-11-10#lab-1#Seqera Cloud#pipeline-42' },
        },
        UpdateExpression:
          `ADD ${counted} :one, ${other} :zero, #ComputeCostUsd :zero, #StorageCostUsd :zero, #FinishedRuns :zero ` +
          'SET #Day = :day, #LaboratoryId = :laboratoryId, #Platform = :platform, ' +
          '#WorkflowExternalId = :workflowExternalId, #ModifiedAt = :now',
      });
      expect(update.ConditionExpression).toBeUndefined();
      expect(update.ExpressionAttributeNames).toEqual({
        '#WarnedRuns': 'WarnedRuns',
        '#BlockedLaunches': 'BlockedLaunches',
        '#ComputeCostUsd': 'ComputeCostUsd',
        '#StorageCostUsd': 'StorageCostUsd',
        '#FinishedRuns': 'FinishedRuns',
        '#Day': 'Day',
        '#LaboratoryId': 'LaboratoryId',
        '#Platform': 'Platform',
        '#WorkflowExternalId': 'WorkflowExternalId',
        '#ModifiedAt': 'ModifiedAt',
      });
      expect(unmarshall(update.ExpressionAttributeValues)).toEqual({
        ':one': 1,
        ':zero': 0,
        ':day': '2026-11-10',
        ':laboratoryId': LABORATORY_ID,
        ':platform': 'Seqera Cloud',
        ':workflowExternalId': 'pipeline-42',
        ':now': expect.any(String),
      });
    });

    it('rethrows a failed write, so the caller decides what a lost count means', async () => {
      const throttled = new Error('Throttled');
      updateItem.mockRejectedValue(throttled);

      await expect(service.addLaunchCount({ ...launch, Kind: 'blocked' })).rejects.toBe(throttled);
    });
  });

  describe('queryRange', () => {
    it('reads every page of an organization between two days, inclusive of the whole end day', async () => {
      const first = { OrganizationId: ORGANIZATION_ID, DayLabWorkflow: '2026-11-01#lab-1#Seqera Cloud#p1' };
      const second = { OrganizationId: ORGANIZATION_ID, DayLabWorkflow: '2026-11-30#lab-1#Seqera Cloud#p1' };
      queryItems
        .mockResolvedValueOnce({ Items: [marshall(first)], LastEvaluatedKey: marshall(first) })
        .mockResolvedValueOnce({ Items: [marshall(second)] });

      await expect(service.queryRange(ORGANIZATION_ID, '2026-11-01', '2026-11-30')).resolves.toEqual([first, second]);

      expect(queryItems).toHaveBeenCalledTimes(2);
      const [firstQuery, secondQuery] = queryItems.mock.calls.map((call) => call[0]);
      expect(firstQuery).toMatchObject({
        TableName: 'unit-test-usage-daily-total-table',
        KeyConditionExpression: '#OrganizationId = :organizationId AND #DayLabWorkflow BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#OrganizationId': 'OrganizationId', '#DayLabWorkflow': 'DayLabWorkflow' },
      });
      expect(firstQuery.ExclusiveStartKey).toBeUndefined();
      expect(unmarshall(firstQuery.ExpressionAttributeValues)).toEqual({
        ':organizationId': ORGANIZATION_ID,
        ':start': '2026-11-01',
        ':end': '2026-11-30#￿',
      });
      expect(secondQuery.ExclusiveStartKey).toEqual(marshall(first));
    });

    it('keeps every key of the end day inside the range and the next day outside it', () => {
      const end = '2026-11-30#￿';
      expect(usageTotalKey('2026-11-30', 'zzzz', 'Seqera Cloud', 'zzzz') <= end).toBe(true);
      expect(usageTotalKey('2026-12-01', 'a', 'AWS HealthOmics', 'a') <= end).toBe(false);
      expect(usageTotalKey('2026-11-01', 'a', 'AWS HealthOmics', 'a') >= '2026-11-01').toBe(true);
    });
  });
});
