import { createHash, randomUUID } from 'node:crypto';
import { AttributeValue, BatchGetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DataCollectionTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collection';
import { DynamoDBService } from '../dynamodb-service';

const TAG_PREFIX = 'TAG#';
const FILE_PREFIX = 'FILE#';

export interface DataCollectionTagRecord extends DataCollectionTag {
  LaboratoryId: string;
  OrganizationId: string;
  DataCollectionKey: string;
}

export interface DataCollectionFileRecord {
  LaboratoryId: string;
  OrganizationId: string;
  DataCollectionKey: string;
  S3Key: string;
  TagIds: string[];
}

export class DataCollectionService extends DynamoDBService {
  readonly TABLE_NAME: string = `${process.env.NAME_PREFIX}-data-collection-table`;

  public fileSortKeyForS3Key(s3Key: string): string {
    const hash = createHash('sha256').update(s3Key, 'utf8').digest('hex');
    return `${FILE_PREFIX}${hash}`;
  }

  public async listTags(laboratoryId: string): Promise<DataCollectionTag[]> {
    const response = await this.queryItems({
      TableName: this.TABLE_NAME,
      KeyConditionExpression: '#LaboratoryId = :lab AND begins_with(#DataCollectionKey, :tag)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#DataCollectionKey': 'DataCollectionKey',
      },
      ExpressionAttributeValues: {
        ':lab': { S: laboratoryId },
        ':tag': { S: TAG_PREFIX },
      },
    });

    if (response.$metadata.httpStatusCode !== 200 || !response.Items?.length) {
      return [];
    }

    return response.Items.map((item) => {
      const row = unmarshall(item) as DataCollectionTagRecord;
      return {
        TagId: row.TagId,
        Name: row.Name,
        Color: row.Color,
        CreatedAt: row.CreatedAt,
        ModifiedAt: row.ModifiedAt,
      };
    });
  }

  public async getTag(laboratoryId: string, tagId: string): Promise<DataCollectionTagRecord | null> {
    const key = `${TAG_PREFIX}${tagId}`;
    const response = await this.getItem({
      TableName: this.TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryId },
        DataCollectionKey: { S: key },
      },
    });
    if (response.$metadata.httpStatusCode !== 200 || !response.Item) {
      return null;
    }
    return unmarshall(response.Item) as DataCollectionTagRecord;
  }

  public async createTag(
    laboratoryId: string,
    organizationId: string,
    name: string,
    color: string,
  ): Promise<DataCollectionTag> {
    const tagId = randomUUID();
    const now = new Date().toISOString();
    const item: DataCollectionTagRecord = {
      LaboratoryId: laboratoryId,
      OrganizationId: organizationId,
      DataCollectionKey: `${TAG_PREFIX}${tagId}`,
      TagId: tagId,
      Name: name,
      Color: color,
      CreatedAt: now,
      ModifiedAt: now,
    };

    await this.putItem({
      TableName: this.TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(#LaboratoryId) AND attribute_not_exists(#DataCollectionKey)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#DataCollectionKey': 'DataCollectionKey',
      },
    });

    return {
      TagId: tagId,
      Name: name,
      Color: color,
      CreatedAt: now,
      ModifiedAt: now,
    };
  }

  public async updateTag(
    laboratoryId: string,
    tagId: string,
    name: string,
    color: string,
  ): Promise<DataCollectionTag | null> {
    const existing = await this.getTag(laboratoryId, tagId);
    if (!existing) return null;

    const now = new Date().toISOString();
    await this.updateItem({
      TableName: this.TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryId },
        DataCollectionKey: { S: existing.DataCollectionKey },
      },
      UpdateExpression: 'SET #Name = :name, #Color = :color, #ModifiedAt = :modified',
      ExpressionAttributeNames: {
        '#Name': 'Name',
        '#Color': 'Color',
        '#ModifiedAt': 'ModifiedAt',
      },
      ExpressionAttributeValues: {
        ':name': { S: name },
        ':color': { S: color },
        ':modified': { S: now },
      },
    });

    return {
      TagId: tagId,
      Name: name,
      Color: color,
      CreatedAt: existing.CreatedAt,
      ModifiedAt: now,
    };
  }

  /**
   * Deletes the tag definition and removes this TagId from every FILE# assignment for the lab.
   */
  public async deleteTagAndStripFromFiles(laboratoryId: string, tagId: string): Promise<boolean> {
    const existing = await this.getTag(laboratoryId, tagId);
    if (!existing) return false;

    let lastKey: Record<string, AttributeValue> | undefined;
    // Paginate FILE# rows
    for (;;) {
      const response = await this.queryItems({
        TableName: this.TABLE_NAME,
        KeyConditionExpression: '#LaboratoryId = :lab AND begins_with(#DataCollectionKey, :file)',
        ExpressionAttributeNames: {
          '#LaboratoryId': 'LaboratoryId',
          '#DataCollectionKey': 'DataCollectionKey',
        },
        ExpressionAttributeValues: {
          ':lab': { S: laboratoryId },
          ':file': { S: FILE_PREFIX },
        },
        ExclusiveStartKey: lastKey,
      });

      const items = response.Items || [];

      for (const raw of items) {
        const row = unmarshall(raw) as DataCollectionFileRecord;
        const tagIds = row.TagIds || [];
        if (!tagIds.includes(tagId)) continue;

        const next = tagIds.filter((id) => id !== tagId);
        if (next.length === 0) {
          await this.deleteItem({
            TableName: this.TABLE_NAME,
            Key: {
              LaboratoryId: { S: laboratoryId },
              DataCollectionKey: { S: row.DataCollectionKey },
            },
          });
        } else {
          await this.updateItem({
            TableName: this.TABLE_NAME,
            Key: {
              LaboratoryId: { S: laboratoryId },
              DataCollectionKey: { S: row.DataCollectionKey },
            },
            UpdateExpression: 'SET #TagIds = :tags',
            ExpressionAttributeNames: { '#TagIds': 'TagIds' },
            ExpressionAttributeValues: {
              ':tags': { L: next.map((id) => ({ S: id })) },
            },
          });
        }
      }

      lastKey = response.LastEvaluatedKey;
      if (!lastKey) break;
    }

    await this.deleteItem({
      TableName: this.TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryId },
        DataCollectionKey: { S: existing.DataCollectionKey },
      },
    });

    return true;
  }

  public async batchGetFileTags(
    laboratoryId: string,
    s3Keys: string[],
  ): Promise<{ S3Key: string; TagIds: string[] }[]> {
    if (s3Keys.length === 0) return [];

    const byKey = new Map<string, string[]>();

    for (let i = 0; i < s3Keys.length; i += 100) {
      const chunk = s3Keys.slice(i, i + 100);
      const keys = chunk.map((s3Key) => ({
        LaboratoryId: { S: laboratoryId },
        DataCollectionKey: { S: this.fileSortKeyForS3Key(s3Key) },
      }));

      const response: BatchGetItemCommandOutput = await this.batchGetItem({
        RequestItems: {
          [this.TABLE_NAME]: { Keys: keys },
        },
      });

      const rows = response.Responses?.[this.TABLE_NAME] || [];
      for (const item of rows) {
        const row = unmarshall(item) as DataCollectionFileRecord;
        byKey.set(row.S3Key, row.TagIds || []);
      }
    }

    return s3Keys.map((s3Key) => ({ S3Key: s3Key, TagIds: byKey.get(s3Key) || [] }));
  }

  public async batchSetFileTags(
    laboratoryId: string,
    organizationId: string,
    items: { S3Key: string; TagIds: string[] }[],
  ): Promise<number> {
    let updated = 0;

    for (const { S3Key: s3Key, TagIds: tagIds } of items) {
      const sk = this.fileSortKeyForS3Key(s3Key);
      if (tagIds.length === 0) {
        await this.deleteItem({
          TableName: this.TABLE_NAME,
          Key: {
            LaboratoryId: { S: laboratoryId },
            DataCollectionKey: { S: sk },
          },
        });
      } else {
        const item: DataCollectionFileRecord = {
          LaboratoryId: laboratoryId,
          OrganizationId: organizationId,
          DataCollectionKey: sk,
          S3Key: s3Key,
          TagIds: tagIds,
        };
        await this.putItem({
          TableName: this.TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
        });
      }
      updated += 1;
    }

    return updated;
  }
}
