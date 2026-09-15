import {
  DeleteItemCommandOutput,
  GetItemCommandOutput,
  PutItemCommandOutput,
  QueryCommandOutput,
  ScanCommandOutput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryRunSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  LaboratoryRunAlreadyExistsError,
  LaboratoryRunNotFoundError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { isConditionalCheckFailed } from './laboratory-data-tagging-service';
import { Service } from '../../types/service';
import { DynamoDBService } from '../dynamodb-service';

/**
 * `InputFileKeys` is stored as a DynamoDB List (L) of strings in normal writes, which unmarshalls to
 * `string[]`. Older or out-of-band data may use a String Set (SS → `Set` at read time) or a Map (M
 * → plain object). `JSON.stringify` turns a `Set` into `{}`, which breaks clients that expect an
 * array. Coerce every read path to `string[]` before the item is returned or serialized.
 */
function coerceInputFileKeys(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((k): k is string => typeof k === 'string');
  }
  if (value instanceof Set) {
    return [...value].filter((k): k is string => typeof k === 'string');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 0) return undefined;
    if (keys.every((k) => /^\d+$/.test(k))) {
      return keys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => o[k])
        .filter((v): v is string => typeof v === 'string');
    }
    return Object.values(o).filter((v): v is string => typeof v === 'string');
  }
  return undefined;
}

function withCoercedInputFileKeys(run: LaboratoryRun): LaboratoryRun {
  const next = coerceInputFileKeys(run.InputFileKeys);
  if (next === undefined && run.InputFileKeys === undefined) return run;
  if (next === undefined) {
    const rest = { ...run };
    delete rest.InputFileKeys;
    return rest as LaboratoryRun;
  }
  return { ...run, InputFileKeys: next };
}

export class LaboratoryRunService extends DynamoDBService implements Service<LaboratoryRun> {
  readonly LABORATORY_RUN_TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-run-table`;

  public constructor() {
    super();
  }

  public add = async (laboratoryRun: LaboratoryRun): Promise<LaboratoryRun> => {
    const logRequestMessage = `Add LaboratoryRun LaboratoryId=${laboratoryRun.LaboratoryId}, RunId=${laboratoryRun.RunId} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!LaboratoryRunSchema.safeParse(laboratoryRun).success) throw new Error('Invalid request');

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      ConditionExpression: 'attribute_not_exists(#LaboratoryId) AND attribute_not_exists(#RunId)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#RunId': 'RunId',
      },
      Item: marshall(laboratoryRun, { removeUndefinedValues: true }),
    });

    if (response.$metadata.httpStatusCode === 200) {
      return laboratoryRun;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  /**
   * Same conditional-insert as `add`, but treats a same-user retry as a successful replay
   * instead of throwing. This is reachable because the run row can be persisted successfully
   * while a later step in create-laboratory-run.lambda.ts (e.g. the SQS status-check enqueue)
   * still fails, returning an error to the client even though the write succeeded. The client
   * then resubmits with the same `RunId`, since AWS HealthOmics returns the same execution for
   * the same idempotency token, which hits this conditional insert a second time. Only the
   * requester's own prior write is treated as a replay; a RunId collision with a different
   * user's run is a genuine anomaly, not a retry, so it's still rejected.
   */
  public addOrGetExisting = async (laboratoryRun: LaboratoryRun, requestingUserId: string): Promise<LaboratoryRun> => {
    try {
      return await this.add(laboratoryRun);
    } catch (err: unknown) {
      if (!isConditionalCheckFailed(err)) throw err;
      const existing = await this.get(laboratoryRun.LaboratoryId, laboratoryRun.RunId);
      if (existing.UserId === requestingUserId) return existing;
      throw new LaboratoryRunAlreadyExistsError(
        `RunId=${laboratoryRun.RunId} already exists for LaboratoryId=${laboratoryRun.LaboratoryId} under a different user`,
      );
    }
  };

  public get = async (laboratoryId: string, runId: string): Promise<LaboratoryRun> => {
    const logRequestMessage = `Get LaboratoryRun LaboratoryId=${laboratoryId}, RunId=${runId} request`;
    console.info(logRequestMessage);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryId }, // Hash Key / Partition Key
        RunId: { S: runId }, // Sort Key
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Item) {
        return withCoercedInputFileKeys(<LaboratoryRun>unmarshall(response.Item));
      } else {
        throw new LaboratoryRunNotFoundError(runId, laboratoryId);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public queryByLaboratoryId = async (laboratoryId: string): Promise<LaboratoryRun[]> => {
    const logRequestMessage = `Query LaboratoryRuns by LaboratoryId=${laboratoryId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      KeyConditionExpression: '#LaboratoryId = :laboratoryId',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId', // Hash / Partition Key
      },
      ExpressionAttributeValues: {
        ':laboratoryId': { S: laboratoryId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Items) {
        return response.Items.map((item) => withCoercedInputFileKeys(<LaboratoryRun>unmarshall(item)));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  /**
   * Scans the entire laboratory-run table and returns all runs.
   * Used for one-off operations (e.g. backfilling Omics run tags).
   */
  public listAllLaboratoryRuns = async (): Promise<LaboratoryRun[]> => {
    const results: LaboratoryRun[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const response: ScanCommandOutput = await this.findAll({
        TableName: this.LABORATORY_RUN_TABLE_NAME,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });
      if (response.Items) {
        for (const item of response.Items) {
          results.push(withCoercedInputFileKeys(unmarshall(item) as LaboratoryRun));
        }
      }
      lastKey = response.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastKey);
    return results;
  };

  public queryByRunId = async (runId: string): Promise<LaboratoryRun> => {
    const logRequestMessage = `Query LaboratoryRuns by RunId=${runId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      IndexName: 'RunId_Index', // Global Secondary Index
      KeyConditionExpression: '#RunId = :RunId',
      ExpressionAttributeNames: {
        '#RunId': 'RunId',
      },
      ExpressionAttributeValues: {
        ':RunId': { S: runId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Items) {
        if (response.Items.length === 1) {
          return withCoercedInputFileKeys(<LaboratoryRun>unmarshall(response.Items.shift()!));
        } else if (response.Items.length === 0) {
          throw new LaboratoryRunNotFoundError(runId);
        } else {
          throw new Error(`${logRequestMessage} unsuccessful: Returned unexpected ${response.Items.length} items`);
        }
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  /**
   * Query completed runs for a workflow via WorkflowExternalId + TerminalAt GSI.
   * Used by the pre-run cost estimator for historical similarity matching.
   */
  public queryByWorkflowExternalId = async (
    workflowExternalId: string,
    options?: { sinceTerminalAt?: string; limit?: number },
  ): Promise<LaboratoryRun[]> => {
    const logRequestMessage = `Query LaboratoryRuns by WorkflowExternalId=${workflowExternalId} request`;
    console.info(logRequestMessage);

    const expressionAttributeNames: Record<string, string> = {
      '#WorkflowExternalId': 'WorkflowExternalId',
    };
    const expressionAttributeValues: Record<string, { S: string }> = {
      ':workflowExternalId': { S: workflowExternalId },
    };
    let keyCondition = '#WorkflowExternalId = :workflowExternalId';
    if (options?.sinceTerminalAt) {
      expressionAttributeNames['#TerminalAt'] = 'TerminalAt';
      expressionAttributeValues[':since'] = { S: options.sinceTerminalAt };
      keyCondition += ' AND #TerminalAt >= :since';
    }

    const results: LaboratoryRun[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const response: QueryCommandOutput = await this.queryItems({
        TableName: this.LABORATORY_RUN_TABLE_NAME,
        IndexName: 'WorkflowExternalId_Index',
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ScanIndexForward: false,
        ...(options?.limit ? { Limit: options.limit } : {}),
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });
      if (response.$metadata.httpStatusCode !== 200) {
        throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
      }
      if (response.Items) {
        for (const item of response.Items) {
          results.push(withCoercedInputFileKeys(<LaboratoryRun>unmarshall(item)));
        }
      }
      lastKey = response.LastEvaluatedKey as Record<string, any> | undefined;
      if (options?.limit && results.length >= options.limit) break;
    } while (lastKey);

    return results;
  };

  public update = async (laboratoryRun: LaboratoryRun): Promise<LaboratoryRun> => {
    return this.updateWithAttributeRemoval(laboratoryRun, []);
  };

  /**
   * Same as `update`, but also REMOVEs the listed attributes from DynamoDB.
   * Used when clearing optional fields (e.g. NotifiedAt) that must not linger
   * after a SET-only update would leave the previous value in place.
   *
   * Attributes in `remove` are stripped from the write payload before `.strict()`
   * schema validation so callers can REMOVE legacy fields that are no longer on
   * the schema (e.g. one-time backfill of `CurrentProcessName`).
   */
  public updateWithAttributeRemoval = async (
    laboratoryRun: LaboratoryRun,
    remove: string[],
  ): Promise<LaboratoryRun> => {
    const logRequestMessage = `Update LaboratoryRun LaboratoryId=${laboratoryRun.LaboratoryId}, RunId=${laboratoryRun.RunId} request`;
    console.info(logRequestMessage);

    const removeAttrs = [...new Set(remove.filter((key) => key.length > 0))];
    const runForUpdate = { ...laboratoryRun } as LaboratoryRun & Record<string, unknown>;
    // Strip before validation so REMOVEd keys (including schema-removed legacy
    // attributes) do not fail LaboratoryRunSchema.strict().
    for (const key of removeAttrs) {
      delete runForUpdate[key];
    }

    // Data validation safety check
    if (!LaboratoryRunSchema.safeParse(runForUpdate).success) throw new Error('Invalid request');

    const updateExclusions: string[] = [
      'LaboratoryId',
      'RunId',
      'UserId',
      'OrganizationId',
      'RunName',
      'Platform',
      'Owner', // User Email for display purposes
      'WorkflowName', // Seqera Pipeline Name or AWS HealthOmics Workflow Name
      'ExternalRunId',
      'CreatedAt',
      'CreatedBy',
    ];

    const expressionAttributeNames: { [p: string]: string } = this.getExpressionAttributeNamesDefinition(
      runForUpdate,
      updateExclusions,
    );
    const expressionAttributeValues: { [p: string]: any } = this.getExpressionAttributeValuesDefinition(
      runForUpdate,
      updateExclusions,
    );
    let updateExpression: string = this.getUpdateExpression(expressionAttributeNames, expressionAttributeValues);

    if (removeAttrs.length > 0) {
      for (const key of removeAttrs) {
        expressionAttributeNames[`#Remove${key}`] = key;
      }
      updateExpression += ` REMOVE ${removeAttrs.map((key) => `#Remove${key}`).join(', ')}`;
    }

    const response: UpdateItemCommandOutput = await this.updateItem({
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryRun.LaboratoryId },
        RunId: { S: laboratoryRun.RunId },
      },
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ReturnValues: 'ALL_NEW',
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Attributes) {
        return withCoercedInputFileKeys(<LaboratoryRun>unmarshall(response.Attributes));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Returned unexpected response`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  /**
   * Targeted DynamoDB update for retention/TTL bookkeeping (`TerminalAt`, `ExpiresAt`,
   * audit fields) without rewriting unrelated run attributes.
   */
  public async updateRetentionMetadata(input: {
    LaboratoryId: string;
    RunId: string;
    set: {
      TerminalAt?: string;
      ExpiresAt?: number;
      ModifiedAt: string;
      ModifiedBy: string;
    };
    remove: string[];
  }): Promise<LaboratoryRun> {
    const expressionAttributeNames: Record<string, string> = {
      '#ModifiedAt': 'ModifiedAt',
      '#ModifiedBy': 'ModifiedBy',
    };
    const valuePayload: Record<string, unknown> = {
      ':ModifiedAt': input.set.ModifiedAt,
      ':ModifiedBy': input.set.ModifiedBy,
    };
    const setFragments = ['#ModifiedAt = :ModifiedAt', '#ModifiedBy = :ModifiedBy'];

    if (input.set.TerminalAt !== undefined) {
      expressionAttributeNames['#TerminalAt'] = 'TerminalAt';
      valuePayload[':TerminalAt'] = input.set.TerminalAt;
      setFragments.push('#TerminalAt = :TerminalAt');
    }
    if (input.set.ExpiresAt !== undefined) {
      expressionAttributeNames['#ExpiresAt'] = 'ExpiresAt';
      valuePayload[':ExpiresAt'] = input.set.ExpiresAt;
      setFragments.push('#ExpiresAt = :ExpiresAt');
    }

    let updateExpression = `SET ${setFragments.join(', ')}`;
    if (input.remove.includes('ExpiresAt')) {
      expressionAttributeNames['#ExpRemove'] = 'ExpiresAt';
      updateExpression += ' REMOVE #ExpRemove';
    }

    const response: UpdateItemCommandOutput = await this.updateItem({
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      Key: {
        LaboratoryId: { S: input.LaboratoryId },
        RunId: { S: input.RunId },
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: marshall(valuePayload, { removeUndefinedValues: true }),
      ReturnValues: 'ALL_NEW',
    });

    if (response.$metadata.httpStatusCode === 200 && response.Attributes) {
      return withCoercedInputFileKeys(<LaboratoryRun>unmarshall(response.Attributes));
    }
    throw new Error(
      `Update retention metadata for LaboratoryId=${input.LaboratoryId} RunId=${input.RunId} failed: HTTP ${response.$metadata.httpStatusCode}`,
    );
  }

  /**
   * Guards the run-completion notification publish behind a conditional write. Only the
   * caller that wins `attribute_not_exists(NotifiedAt)` gets `published: true` — a duplicate
   * or retried status-check message for the same terminal state gets `published: false` and
   * must not re-publish to the notification topic.
   */
  public async markTerminalNotified(input: {
    LaboratoryId: string;
    RunId: string;
    ModifiedAt: string;
    ModifiedBy: string;
  }): Promise<{ published: boolean; run: LaboratoryRun }> {
    try {
      const response: UpdateItemCommandOutput = await this.updateItem({
        TableName: this.LABORATORY_RUN_TABLE_NAME,
        Key: {
          LaboratoryId: { S: input.LaboratoryId },
          RunId: { S: input.RunId },
        },
        UpdateExpression:
          'SET #NotifiedAt = :NotifiedAt, #ModifiedAt = :ModifiedAt, #ModifiedBy = :ModifiedBy REMOVE #PollStatus',
        ConditionExpression: 'attribute_not_exists(#NotifiedAt)',
        ExpressionAttributeNames: {
          '#NotifiedAt': 'NotifiedAt',
          '#ModifiedAt': 'ModifiedAt',
          '#ModifiedBy': 'ModifiedBy',
          '#PollStatus': 'PollStatus',
        },
        ExpressionAttributeValues: marshall({
          ':NotifiedAt': input.ModifiedAt,
          ':ModifiedAt': input.ModifiedAt,
          ':ModifiedBy': input.ModifiedBy,
        }),
        ReturnValues: 'ALL_NEW',
      });

      if (response.$metadata.httpStatusCode === 200 && response.Attributes) {
        return { published: true, run: withCoercedInputFileKeys(<LaboratoryRun>unmarshall(response.Attributes)) };
      }
      throw new Error(
        `markTerminalNotified for LaboratoryId=${input.LaboratoryId} RunId=${input.RunId} failed: HTTP ${response.$metadata.httpStatusCode}`,
      );
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') {
        return { published: false, run: await this.get(input.LaboratoryId, input.RunId) };
      }
      throw err;
    }
  }

  /**
   * Queries the sparse `PollStatus_Index` GSI for every currently non-terminal run, across
   * all labs. Cost stays flat regardless of total historical run volume (unlike a full scan
   * or a per-lab query loop) because only active runs carry the `PollStatus` attribute.
   */
  public queryActiveForPolling = async (): Promise<LaboratoryRun[]> => {
    const results: LaboratoryRun[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const response: QueryCommandOutput = await this.queryItems({
        TableName: this.LABORATORY_RUN_TABLE_NAME,
        IndexName: 'PollStatus_Index',
        KeyConditionExpression: '#PollStatus = :pollStatus',
        ExpressionAttributeNames: { '#PollStatus': 'PollStatus' },
        ExpressionAttributeValues: { ':pollStatus': { S: 'ACTIVE' } },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });
      if (response.Items) {
        results.push(...response.Items.map((item) => withCoercedInputFileKeys(<LaboratoryRun>unmarshall(item))));
      }
      lastKey = response.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastKey);
    return results;
  };

  public delete = async (laboratoryRun: LaboratoryRun): Promise<boolean> => {
    const logRequestMessage = `Delete LaboratoryRun LaboratoryId=${laboratoryRun.LaboratoryId}, RunId=${laboratoryRun.RunId} request`;
    console.info(logRequestMessage);

    const response: DeleteItemCommandOutput = await this.deleteItem({
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryRun.LaboratoryId },
        RunId: { S: laboratoryRun.RunId },
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };
}
