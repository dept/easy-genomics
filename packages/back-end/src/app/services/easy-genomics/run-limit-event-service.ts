import { createHash } from 'crypto';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import { RunLimitEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/run-limit-events';
import { DynamoDBService } from '../dynamodb-service';
import { UsageTotalsService, isConditionFailedAt } from './usage-totals-service';

export type RecordRunLimitEventResult = 'recorded' | 'already-recorded';

export type RunLimitEventToRecord = Omit<RunLimitEvent, 'EventKey' | 'Day' | 'ExpiresAt'> & { EventId: string };

const EVENT_RETENTION_DAYS = 396; // 13 months
const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_LIST_LIMIT = 500;

/** Sorts after every key of a day, so a `BETWEEN` ending here includes the whole day. */
const LAST_KEY_OF_DAY_SUFFIX = '#￿';

export function runLimitEventKey(kind: RunLimitEvent['Kind'], day: string, id: string): string {
  return `${kind}#${day}#${id}`;
}

/**
 * One blocked attempt per user, lab, workflow, sample sheet and source; a missing sheet hashes as an
 * empty one. The source keeps a launch blocked after a blocked review from passing as the review.
 */
export function blockedAttemptId(attempt: {
  laboratoryId: string;
  platform: RunType;
  workflowExternalId: string;
  userId: string;
  sampleSheetS3Url?: string;
  source: RunLimitEvent['Source'];
}): string {
  const parts = [
    attempt.laboratoryId,
    attempt.platform,
    attempt.workflowExternalId,
    attempt.userId,
    attempt.sampleSheetS3Url ?? '',
    attempt.source,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/**
 * The 13-month record of warned launches and blocked attempts. An event and its day's count go
 * up in one transaction, so a count only rises when the event is new.
 */
export class RunLimitEventService extends DynamoDBService {
  readonly RUN_LIMIT_EVENT_TABLE_NAME: string = `${process.env.NAME_PREFIX}-run-limit-event-table`;

  private readonly usageTotalsService = new UsageTotalsService();

  public constructor() {
    super();
  }

  public record = async (input: RunLimitEventToRecord): Promise<RecordRunLimitEventResult> => {
    const { EventId, ...fields } = input;
    const day = input.OccurredAt.slice(0, 10);
    const event: RunLimitEvent = {
      ...fields,
      EventKey: runLimitEventKey(input.Kind, day, EventId),
      Day: day,
      ExpiresAt: Math.floor(Date.parse(input.OccurredAt) / 1000) + EVENT_RETENTION_DAYS * SECONDS_PER_DAY,
    };

    // The review step repeats the same block on every refresh. Checking first keeps those repeats out of
    // the transaction, whose cancellation the DynamoDB layer logs as an error; the condition below still
    // decides a race between two first calls.
    if (await this.isStored(event)) {
      return 'already-recorded';
    }

    try {
      await this.transactWriteItems({
        TransactItems: [
          {
            Put: {
              TableName: this.RUN_LIMIT_EVENT_TABLE_NAME,
              Item: marshall(event, { removeUndefinedValues: true }),
              ConditionExpression: 'attribute_not_exists(EventKey)',
            },
          },
          {
            Update: this.usageTotalsService.launchCountUpdate(
              {
                OrganizationId: input.OrganizationId,
                LaboratoryId: input.LaboratoryId,
                Platform: input.Platform,
                WorkflowExternalId: input.WorkflowExternalId,
                Day: day,
                Kind: input.Kind,
              },
              new Date().toISOString(),
            ),
          },
        ],
      });
      return 'recorded';
    } catch (err) {
      if (isConditionFailedAt(err, 0)) {
        return 'already-recorded';
      }
      throw err;
    }
  };

  /** Newest first. Reads the kind's days newest-first and stops once the newest `limit` events are certain. */
  public listForPeriod = async (
    organizationId: string,
    startDay: string,
    endDay: string,
    kind: RunLimitEvent['Kind'],
    limit: number = DEFAULT_LIST_LIMIT,
  ): Promise<{ events: RunLimitEvent[]; truncated: boolean }> => {
    const events: RunLimitEvent[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const response = await this.queryItems({
        TableName: this.RUN_LIMIT_EVENT_TABLE_NAME,
        KeyConditionExpression: '#OrganizationId = :organizationId AND #EventKey BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#OrganizationId': 'OrganizationId', '#EventKey': 'EventKey' },
        ExpressionAttributeValues: marshall({
          ':organizationId': organizationId,
          ':start': `${kind}#${startDay}`,
          ':end': `${kind}#${endDay}${LAST_KEY_OF_DAY_SUFFIX}`,
        }),
        ScanIndexForward: false,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });
      for (const item of response.Items ?? []) {
        events.push(<RunLimitEvent>unmarshall(item));
      }
      lastKey = this.hasNewestEvents(events, limit) ? undefined : response.LastEvaluatedKey;
    } while (lastKey);

    events.sort((a, b) => b.OccurredAt.localeCompare(a.OccurredAt));
    return { events: events.slice(0, limit), truncated: events.length > limit };
  };

  /**
   * Keys within a day are ordered by event id, not time, so the day holding the `limit`-th event
   * read must be read to its end before the newest `limit` are known. A read event from an older
   * day proves it was.
   */
  private hasNewestEvents(eventsInReadOrder: RunLimitEvent[], limit: number): boolean {
    if (limit < 1) return true;
    if (eventsInReadOrder.length <= limit) return false;
    const boundaryDay = eventsInReadOrder[limit - 1].Day;
    return eventsInReadOrder[eventsInReadOrder.length - 1].Day < boundaryDay;
  }

  private async isStored(event: RunLimitEvent): Promise<boolean> {
    const response = await this.getItem({
      TableName: this.RUN_LIMIT_EVENT_TABLE_NAME,
      Key: marshall({ OrganizationId: event.OrganizationId, EventKey: event.EventKey }),
      ProjectionExpression: 'EventKey',
    });
    return response.Item !== undefined;
  }
}
