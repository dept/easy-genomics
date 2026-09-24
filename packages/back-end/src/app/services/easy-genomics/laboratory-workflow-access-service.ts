import { DeleteItemCommandOutput, PutItemCommandOutput, QueryCommandOutput, ScanCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  LaboratoryWorkflowAccess,
  LaboratoryWorkflowAccessPlatform,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { laboratoryWorkflowAccessSortKey } from '../../utils/laboratory-workflow-access-utils';
import { DynamoDBService } from '../dynamodb-service';

export class LaboratoryWorkflowAccessService extends DynamoDBService {
  readonly TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-workflow-access-table`;

  public constructor() {
    super();
  }

  public listByLaboratoryId = async (laboratoryId: string): Promise<LaboratoryWorkflowAccess[]> => {
    const logRequestMessage = `Query LaboratoryWorkflowAccess LaboratoryId=${laboratoryId}`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.TABLE_NAME,
      KeyConditionExpression: '#LaboratoryId = :laboratoryId',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
      },
      ExpressionAttributeValues: {
        ':laboratoryId': { S: laboratoryId },
      },
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    if (!response.Items?.length) {
      return [];
    }

    return response.Items.map((item) => <LaboratoryWorkflowAccess>unmarshall(item));
  };

  public findAssignment = async (
    laboratoryId: string,
    platform: LaboratoryWorkflowAccessPlatform,
    workflowId: string,
  ): Promise<LaboratoryWorkflowAccess | undefined> => {
    const rows = await this.listByLaboratoryId(laboratoryId);
    const key = laboratoryWorkflowAccessSortKey(platform, workflowId);
    return rows.find((r) => r.WorkflowKey === key);
  };

  public upsert = async (row: LaboratoryWorkflowAccess): Promise<LaboratoryWorkflowAccess> => {
    const now = new Date().toISOString();
    const withTs: LaboratoryWorkflowAccess = {
      ...row,
      CreatedAt: row.CreatedAt ?? now,
      ModifiedAt: now,
    };

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.TABLE_NAME,
      Item: marshall(withTs, { removeUndefinedValues: true }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Put LaboratoryWorkflowAccess failed: HTTP ${response.$metadata.httpStatusCode}`);
    }
    return withTs;
  };

  public remove = async (
    laboratoryId: string,
    platform: LaboratoryWorkflowAccessPlatform,
    workflowId: string,
  ): Promise<void> => {
    const sortKey = laboratoryWorkflowAccessSortKey(platform, workflowId);
    const response: DeleteItemCommandOutput = await this.deleteItem({
      TableName: this.TABLE_NAME,
      Key: marshall({
        LaboratoryId: laboratoryId,
        WorkflowKey: sortKey,
      }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Delete LaboratoryWorkflowAccess failed: HTTP ${response.$metadata.httpStatusCode}`);
    }
  };

  /**
   * Scans for every lab grant on a workflow. There is no WorkflowKey GSI, so this
   * is a filtered table scan used only when the HealthOmics workflow itself is gone.
   */
  public listAllForWorkflow = async (
    platform: LaboratoryWorkflowAccessPlatform,
    workflowId: string,
  ): Promise<LaboratoryWorkflowAccess[]> => {
    const workflowKey = laboratoryWorkflowAccessSortKey(platform, workflowId);
    const results: LaboratoryWorkflowAccess[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const response: ScanCommandOutput = await this.findAll({
        TableName: this.TABLE_NAME,
        FilterExpression: '#WorkflowKey = :workflowKey',
        ExpressionAttributeNames: {
          '#WorkflowKey': 'WorkflowKey',
        },
        ExpressionAttributeValues: {
          ':workflowKey': { S: workflowKey },
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });

      if (response.$metadata.httpStatusCode !== 200) {
        throw new Error(`Scan LaboratoryWorkflowAccess for ${workflowKey} failed: HTTP ${response.$metadata.httpStatusCode}`);
      }

      if (response.Items?.length) {
        results.push(...response.Items.map((item) => <LaboratoryWorkflowAccess>unmarshall(item)));
      }
      lastKey = response.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastKey);
    return results;
  };

  public removeAllForWorkflow = async (
    platform: LaboratoryWorkflowAccessPlatform,
    workflowId: string,
  ): Promise<void> => {
    const rows = await this.listAllForWorkflow(platform, workflowId);
    for (const row of rows) {
      await this.remove(row.LaboratoryId, platform, workflowId);
    }
  };
}
