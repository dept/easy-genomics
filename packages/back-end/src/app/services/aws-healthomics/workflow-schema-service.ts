import { GetItemCommandOutput, PutItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBService } from '../dynamodb-service';

export interface WorkflowSchema {
  WorkflowId: string;
  Version: string;
  Schema: object; // Parsed nextflow_schema.json blob
  UpdatedAt: string;
}

export class WorkflowSchemaService extends DynamoDBService {
  readonly WORKFLOW_SCHEMA_TABLE_NAME: string = `${process.env.NAME_PREFIX}-workflow-schema-table`;

  public constructor() {
    super();
  }

  public saveSchema = async (record: WorkflowSchema): Promise<WorkflowSchema> => {
    console.info(`[WorkflowSchemaService] saveSchema WorkflowId=${record.WorkflowId}, Version=${record.Version}`);

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.WORKFLOW_SCHEMA_TABLE_NAME,
      Item: marshall(
        {
          WorkflowId: record.WorkflowId,
          Version: record.Version,
          Schema: JSON.stringify(record.Schema),
          UpdatedAt: record.UpdatedAt,
        },
        { removeUndefinedValues: true },
      ),
    });

    if (response.$metadata.httpStatusCode === 200) {
      return record;
    } else {
      throw new Error(`Failed to save workflow schema: ${JSON.stringify(response)}`);
    }
  };

  public getSchema = async (workflowId: string, version: string): Promise<WorkflowSchema | null> => {
    console.info(`[WorkflowSchemaService] getSchema WorkflowId=${workflowId}, Version=${version}`);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.WORKFLOW_SCHEMA_TABLE_NAME,
      Key: marshall({
        WorkflowId: workflowId,
        Version: version,
      }),
    });

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    return {
      WorkflowId: item.WorkflowId,
      Version: item.Version,
      Schema: JSON.parse(item.Schema),
      UpdatedAt: item.UpdatedAt,
    };
  };
}
