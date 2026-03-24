import {
  AttributeValue,
  DeleteItemCommandOutput,
  GetItemCommandOutput,
  PutItemCommandOutput,
  QueryCommandInput,
  QueryCommandOutput,
  ScanCommandOutput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryRunNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { LaboratoryRunSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { Service } from '../../types/service';
import { DynamoDBService } from '../dynamodb-service';

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
        return <LaboratoryRun>unmarshall(response.Item);
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
        return response.Items.map((item) => <LaboratoryRun>unmarshall(item));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

<<<<<<< feat/egv-25-tag-based-access-controls
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
          results.push(unmarshall(item) as LaboratoryRun);
        }
      }
      lastKey = response.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastKey);
    return results;
=======
  public queryByLaboratoryIdPaginated = async ({
    laboratoryId,
    limit,
    sortBy,
    sortDirection,
    filters,
    exclusiveStartKey,
  }: {
    laboratoryId: string;
    limit: number;
    sortBy: 'CreatedAt' | 'ModifiedAt';
    sortDirection: 'asc' | 'desc';
    filters: { UserId?: string; Status?: string };
    exclusiveStartKey?: Record<string, AttributeValue>;
  }): Promise<{
    items: LaboratoryRun[];
    lastEvaluatedKey?: Record<string, AttributeValue>;
  }> => {
    const logRequestMessage = `Query LaboratoryRuns paginated by LaboratoryId=${laboratoryId} request`;
    console.info(logRequestMessage);

    const expressionAttributeNames: Record<string, string> = {
      '#LaboratoryId': 'LaboratoryId',
    };
    const expressionAttributeValues: Record<string, AttributeValue> = {
      ':laboratoryId': { S: laboratoryId },
    };
    const filterExpressionParts: string[] = [];

    if (filters.UserId) {
      expressionAttributeNames['#UserId'] = 'UserId';
      expressionAttributeValues[':userId'] = { S: filters.UserId };
      filterExpressionParts.push('#UserId = :userId');
    }

    if (filters.Status) {
      expressionAttributeNames['#Status'] = 'Status';
      expressionAttributeValues[':status'] = { S: filters.Status };
      filterExpressionParts.push('#Status = :status');
    }

    const queryInput: QueryCommandInput = {
      TableName: this.LABORATORY_RUN_TABLE_NAME,
      KeyConditionExpression: '#LaboratoryId = :laboratoryId',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: sortDirection === 'asc',
      IndexName: `${sortBy}_Index`,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
      ...(filterExpressionParts.length > 0 ? { FilterExpression: filterExpressionParts.join(' AND ') } : {}),
    };

    const items: LaboratoryRun[] = [];
    let queryResponse: QueryCommandOutput = await this.queryItems(queryInput);

    if (queryResponse.Items) {
      items.push(...queryResponse.Items.map((item) => <LaboratoryRun>unmarshall(item)));
    }

    // FilterExpression is applied after reads. Continue querying until page is filled or no more results.
    while (items.length < limit && queryResponse.LastEvaluatedKey) {
      const remaining = limit - items.length;
      queryInput.Limit = remaining;
      queryInput.ExclusiveStartKey = queryResponse.LastEvaluatedKey;
      queryResponse = await this.queryItems(queryInput);
      if (queryResponse.Items) {
        items.push(...queryResponse.Items.map((item) => <LaboratoryRun>unmarshall(item)));
      }
    }

    return {
      items,
      lastEvaluatedKey: queryResponse.LastEvaluatedKey,
    };
>>>>>>> development
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
          return <LaboratoryRun>unmarshall(response.Items.shift()!);
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

  public update = async (laboratoryRun: LaboratoryRun): Promise<LaboratoryRun> => {
    const logRequestMessage = `Update LaboratoryRun LaboratoryId=${laboratoryRun.LaboratoryId}, RunId=${laboratoryRun.RunId} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!LaboratoryRunSchema.safeParse(laboratoryRun).success) throw new Error('Invalid request');

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
      laboratoryRun,
      updateExclusions,
    );
    const expressionAttributeValues: { [p: string]: any } = this.getExpressionAttributeValuesDefinition(
      laboratoryRun,
      updateExclusions,
    );
    const updateExpression: string = this.getUpdateExpression(expressionAttributeNames, expressionAttributeValues);

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
        return <LaboratoryRun>unmarshall(response.Attributes);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Returned unexpected response`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
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
