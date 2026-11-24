import { TransactionCanceledException, TransactWriteItem } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { UsageDailyTotal } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
import { DynamoDBService } from '../dynamodb-service';

export type AddRunCostResult = 'counted' | 'already-counted' | 'not-countable';

/** Lab and workflow IDs never contain `#`, so the day prefix sorts and ranges cleanly. */
export function usageTotalKey(
  day: string,
  laboratoryId: string,
  platform: RunType,
  workflowExternalId: string,
): string {
  return `${day}#${laboratoryId}#${platform}#${workflowExternalId}`;
}

/** Sorts after every key of a day, so a `BETWEEN` ending here includes the whole day. */
const LAST_KEY_OF_DAY_SUFFIX = '#￿';

/**
 * Daily cost and run counts per organization, lab, workflow and UTC finishing day. Each run is
 * counted once: the run's `RunCostCountedAt` marker and the day's additions are one transaction.
 */
export class UsageTotalsService extends DynamoDBService {
  readonly USAGE_DAILY_TOTAL_TABLE_NAME: string = `${process.env.NAME_PREFIX}-usage-daily-total-table`;
  readonly LABORATORY_RUN_TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-run-table`;

  public constructor() {
    super();
  }

  /**
   * Adds a run's captured cost to its finishing day. A run without a captured compute cost is
   * never counted as $0; it is skipped and logged.
   */
  public addRunCost = async (run: LaboratoryRun): Promise<AddRunCostResult> => {
    const missingField = findMissingCountField(run);
    if (missingField) {
      console.info(`Run cost not added to the usage totals for RunId=${run.RunId}: ${missingField} is missing`);
      return 'not-countable';
    }

    try {
      await this.transactWriteItems({ TransactItems: this.countRunCostItems(run, new Date().toISOString()) });
      return 'counted';
    } catch (err) {
      if (isRunAlreadyCounted(err)) {
        return 'already-counted';
      }
      throw err;
    }
  };

  public queryRange = async (organizationId: string, startDay: string, endDay: string): Promise<UsageDailyTotal[]> => {
    const totals: UsageDailyTotal[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const response = await this.queryItems({
        TableName: this.USAGE_DAILY_TOTAL_TABLE_NAME,
        KeyConditionExpression: '#OrganizationId = :organizationId AND #DayLabWorkflow BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#OrganizationId': 'OrganizationId', '#DayLabWorkflow': 'DayLabWorkflow' },
        ExpressionAttributeValues: marshall({
          ':organizationId': organizationId,
          ':start': startDay,
          ':end': `${endDay}${LAST_KEY_OF_DAY_SUFFIX}`,
        }),
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });
      for (const item of response.Items ?? []) {
        totals.push(<UsageDailyTotal>unmarshall(item));
      }
      lastKey = response.LastEvaluatedKey;
    } while (lastKey);
    return totals;
  };

  private countRunCostItems(run: LaboratoryRun, now: string): TransactWriteItem[] {
    const day = run.TerminalAt!.slice(0, 10);
    const workflowExternalId = run.WorkflowExternalId!;
    const setWorkflowName = run.WorkflowName ? ', #WorkflowName = if_not_exists(#WorkflowName, :workflowName)' : '';

    return [
      {
        Update: {
          TableName: this.LABORATORY_RUN_TABLE_NAME,
          Key: { LaboratoryId: { S: run.LaboratoryId }, RunId: { S: run.RunId } },
          UpdateExpression: 'SET #RunCostCountedAt = :now',
          ConditionExpression: 'attribute_not_exists(#RunCostCountedAt) AND attribute_exists(#RunId)',
          ExpressionAttributeNames: { '#RunCostCountedAt': 'RunCostCountedAt', '#RunId': 'RunId' },
          ExpressionAttributeValues: marshall({ ':now': now }),
        },
      },
      {
        Update: {
          TableName: this.USAGE_DAILY_TOTAL_TABLE_NAME,
          Key: {
            OrganizationId: { S: run.OrganizationId },
            DayLabWorkflow: { S: usageTotalKey(day, run.LaboratoryId, run.Platform, workflowExternalId) },
          },
          UpdateExpression:
            'ADD #ComputeCostUsd :computeCostUsd, #StorageCostUsd :storageCostUsd, #FinishedRuns :one, ' +
            '#WarnedRuns :zero, #BlockedLaunches :zero ' +
            'SET #Day = :day, #LaboratoryId = :laboratoryId, #Platform = :platform, ' +
            `#WorkflowExternalId = :workflowExternalId, #ModifiedAt = :now${setWorkflowName}`,
          ExpressionAttributeNames: {
            '#ComputeCostUsd': 'ComputeCostUsd',
            '#StorageCostUsd': 'StorageCostUsd',
            '#FinishedRuns': 'FinishedRuns',
            '#WarnedRuns': 'WarnedRuns',
            '#BlockedLaunches': 'BlockedLaunches',
            '#Day': 'Day',
            '#LaboratoryId': 'LaboratoryId',
            '#Platform': 'Platform',
            '#WorkflowExternalId': 'WorkflowExternalId',
            '#ModifiedAt': 'ModifiedAt',
            ...(run.WorkflowName ? { '#WorkflowName': 'WorkflowName' } : {}),
          },
          ExpressionAttributeValues: marshall(
            {
              ':computeCostUsd': run.RunCostOutcome!.ActualComputeCostUsd,
              ':storageCostUsd': run.RunCostOutcome!.ActualStorageCostUsd ?? 0,
              ':one': 1,
              ':zero': 0,
              ':day': day,
              ':laboratoryId': run.LaboratoryId,
              ':platform': run.Platform,
              ':workflowExternalId': workflowExternalId,
              ':now': now,
              ':workflowName': run.WorkflowName,
            },
            { removeUndefinedValues: true },
          ),
        },
      },
    ];
  }
}

export function findMissingCountField(run: LaboratoryRun): string | undefined {
  if (!run.TerminalAt) return 'TerminalAt';
  if (typeof run.RunCostOutcome?.ActualComputeCostUsd !== 'number') return 'RunCostOutcome.ActualComputeCostUsd';
  if (!run.WorkflowExternalId) return 'WorkflowExternalId';
  return undefined;
}

/** The run's marker is item 0, so a failed condition there means another add already counted it. */
function isRunAlreadyCounted(err: unknown): boolean {
  return (
    (err instanceof TransactionCanceledException ||
      (err as { name?: string })?.name === 'TransactionCanceledException') &&
    (err as TransactionCanceledException).CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed'
  );
}
