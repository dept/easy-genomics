import { DeleteItemCommandOutput, PutItemCommandOutput, QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryS3Access } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { DynamoDBService } from '../dynamodb-service';

export class LaboratoryS3AccessService extends DynamoDBService {
  readonly TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-s3-access-table`;

  public constructor() {
    super();
  }

  public listByLaboratoryId = async (laboratoryId: string): Promise<LaboratoryS3Access[]> => {
    const logRequestMessage = `Query LaboratoryS3Access LaboratoryId=${laboratoryId}`;
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

    return response.Items.map((item) => <LaboratoryS3Access>unmarshall(item));
  };

  public findAssignment = async (laboratoryId: string, bucketName: string): Promise<LaboratoryS3Access | undefined> => {
    const rows = await this.listByLaboratoryId(laboratoryId);
    return rows.find((r) => r.BucketName === bucketName);
  };

  public upsert = async (row: LaboratoryS3Access): Promise<LaboratoryS3Access> => {
    const now = new Date().toISOString();
    const withTs: LaboratoryS3Access = {
      ...row,
      CreatedAt: row.CreatedAt ?? now,
      ModifiedAt: now,
    };

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.TABLE_NAME,
      Item: marshall(withTs, { removeUndefinedValues: true }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Put LaboratoryS3Access failed: HTTP ${response.$metadata.httpStatusCode}`);
    }
    return withTs;
  };

  public remove = async (laboratoryId: string, bucketName: string): Promise<void> => {
    const response: DeleteItemCommandOutput = await this.deleteItem({
      TableName: this.TABLE_NAME,
      Key: marshall({
        LaboratoryId: laboratoryId,
        BucketName: bucketName,
      }),
    });

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Delete LaboratoryS3Access failed: HTTP ${response.$metadata.httpStatusCode}`);
    }
  };
}
