import { DeleteItemCommandOutput, GetItemCommandOutput, PutItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { WorkflowKeyOutputsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import { WorkflowKeyOutputs } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { Service } from '../../types/service';
import { DynamoDBService } from '../dynamodb-service';

export class WorkflowKeyOutputsService extends DynamoDBService implements Service<WorkflowKeyOutputs> {
  readonly WORKFLOW_KEY_OUTPUTS_TABLE_NAME: string = `${process.env.NAME_PREFIX}-workflow-key-outputs-table`;

  public constructor() {
    super();
  }

  public add = async (definition: WorkflowKeyOutputs): Promise<WorkflowKeyOutputs> => {
    return this.putDefinition(definition, false);
  };

  public get = async (laboratoryId: string, workflowId?: string): Promise<WorkflowKeyOutputs | undefined> => {
    const logRequestMessage = `Get WorkflowKeyOutputs LaboratoryId=${laboratoryId}, WorkflowId=${workflowId}`;
    console.info(logRequestMessage);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.WORKFLOW_KEY_OUTPUTS_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryId },
        WorkflowId: { S: workflowId! },
      },
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    if (!response.Item) {
      return undefined;
    }

    return <WorkflowKeyOutputs>unmarshall(response.Item);
  };

  public update = async (definition: WorkflowKeyOutputs): Promise<WorkflowKeyOutputs> => {
    return this.putDefinition(definition, true);
  };

  /**
   * Create or replace the lab's definition for this workflow. Callers send the
   * full KeyOutputs array; an empty array is a valid "nothing declared" state.
   */
  public save = async (definition: WorkflowKeyOutputs): Promise<WorkflowKeyOutputs> => {
    const existing = await this.get(definition.LaboratoryId, definition.WorkflowId);
    if (existing) {
      return this.update({
        ...definition,
        CreatedAt: existing.CreatedAt,
        CreatedBy: existing.CreatedBy,
      });
    }
    return this.add(definition);
  };

  public delete = async (definition: WorkflowKeyOutputs): Promise<boolean> => {
    const logRequestMessage = `Delete WorkflowKeyOutputs LaboratoryId=${definition.LaboratoryId}, WorkflowId=${definition.WorkflowId}`;
    console.info(logRequestMessage);

    const response: DeleteItemCommandOutput = await this.deleteItem({
      TableName: this.WORKFLOW_KEY_OUTPUTS_TABLE_NAME,
      Key: {
        LaboratoryId: { S: definition.LaboratoryId },
        WorkflowId: { S: definition.WorkflowId },
      },
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    return true;
  };

  private putDefinition = async (definition: WorkflowKeyOutputs, mustExist: boolean): Promise<WorkflowKeyOutputs> => {
    const logRequestMessage = `${mustExist ? 'Update' : 'Add'} WorkflowKeyOutputs LaboratoryId=${definition.LaboratoryId}, WorkflowId=${definition.WorkflowId}`;
    console.info(logRequestMessage);

    if (!WorkflowKeyOutputsSchema.safeParse(definition).success) {
      throw new Error('Invalid request');
    }

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.WORKFLOW_KEY_OUTPUTS_TABLE_NAME,
      ConditionExpression: mustExist
        ? 'attribute_exists(#LaboratoryId) AND attribute_exists(#WorkflowId)'
        : 'attribute_not_exists(#LaboratoryId) AND attribute_not_exists(#WorkflowId)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#WorkflowId': 'WorkflowId',
      },
      Item: marshall(definition, { removeUndefinedValues: true }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP ${response.$metadata.httpStatusCode}`);
    }

    return definition;
  };
}
