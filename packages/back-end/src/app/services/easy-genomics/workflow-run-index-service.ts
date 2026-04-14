import { PutItemCommandOutput, QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryRunSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { DynamoDBService } from '../dynamodb-service';

/**
 * Unified workflow run index used to power lab-scoped run listings.
 *
 * Today we store the `LaboratoryRun` shape directly to minimize duplication/mapping.
 * The table is keyed by (LaboratoryId, RunId).
 */
export class WorkflowRunIndexService extends DynamoDBService {
  readonly WORKFLOW_RUN_INDEX_TABLE_NAME: string =
    process.env.WORKFLOW_RUN_INDEX_TABLE_NAME ?? `${process.env.NAME_PREFIX}-workflow-run-index-table`;

  public constructor() {
    super();
  }

  /**
   * Upsert a workflow run index record. This is intentionally idempotent and safe to re-run.
   */
  public upsert = async (laboratoryRun: LaboratoryRun): Promise<void> => {
    // Data validation safety check (same schema we store)
    if (!LaboratoryRunSchema.safeParse(laboratoryRun).success) throw new Error('Invalid LaboratoryRun');

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.WORKFLOW_RUN_INDEX_TABLE_NAME,
      Item: marshall(laboratoryRun, { removeUndefinedValues: true }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(
        `Upsert workflow run index failed: HTTP Status Code=${response.$metadata.httpStatusCode} Table=${this.WORKFLOW_RUN_INDEX_TABLE_NAME}`,
      );
    }
  };

  public queryByLaboratoryId = async (laboratoryId: string): Promise<LaboratoryRun[]> => {
    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.WORKFLOW_RUN_INDEX_TABLE_NAME,
      KeyConditionExpression: '#LaboratoryId = :laboratoryId',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
      },
      ExpressionAttributeValues: {
        ':laboratoryId': { S: laboratoryId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(
        `Query workflow run index failed: HTTP Status Code=${response.$metadata.httpStatusCode} Table=${this.WORKFLOW_RUN_INDEX_TABLE_NAME}`,
      );
    }

    return (response.Items ?? []).map((item) => unmarshall(item) as LaboratoryRun);
  };
}
