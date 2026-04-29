import { randomUUID } from 'crypto';
import { BatchGetItemCommandOutput, QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  FileTagAssignment,
  LaboratoryDataTag,
  ListFilesByTagResponse,
  ListLaboratoryDataTagsResponse,
  S3TaggedObjectRef,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { DynamoDBService } from '../dynamodb-service';

const TABLE_NAME = `${process.env.NAME_PREFIX}-laboratory-data-tagging-table`;
const GSI1_NAME = 'Gsi1Pk_Index';

export function encodeS3ObjectRef(bucket: string, key: string): string {
  return Buffer.from(JSON.stringify({ bucket, key }), 'utf8').toString('base64url');
}

export function decodeS3ObjectRef(ref: string): { bucket: string; key: string } {
  const parsed = JSON.parse(Buffer.from(ref, 'base64url').toString('utf8')) as { bucket: string; key: string };
  return parsed;
}

function skTag(tagId: string): string {
  return `TAG#${tagId}`;
}

function skFile(ref: string): string {
  return `FILE#${ref}`;
}

function skMap(tagId: string, ref: string): string {
  return `MAP#${tagId}#${ref}`;
}

function gsi1PkForTag(laboratoryId: string, tagId: string): string {
  return `${laboratoryId}#TAG#${tagId}`;
}

export class LaboratoryDataTaggingService extends DynamoDBService {
  public assertKeyUnderLabPrefix(laboratory: Laboratory, key: string): void {
    const root = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    if (!key.startsWith(root)) {
      throw new Error('S3 key is outside the laboratory prefix');
    }
  }

  public assertBucketMatchesLab(laboratory: Laboratory, bucket: string): void {
    if (!laboratory.S3Bucket || laboratory.S3Bucket !== bucket) {
      throw new Error('S3 bucket does not match laboratory configuration');
    }
  }

  public async listTags(laboratoryId: string): Promise<ListLaboratoryDataTagsResponse> {
    const response: QueryCommandOutput = await this.queryItems({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :tagPrefix)',
      ExpressionAttributeNames: {
        '#pk': 'LaboratoryId',
        '#sk': 'Sk',
      },
      ExpressionAttributeValues: {
        ':pk': { S: laboratoryId },
        ':tagPrefix': { S: 'TAG#' },
      },
    });

    const tags: LaboratoryDataTag[] = (response.Items || []).map((item) => {
      const row = unmarshall(item) as Record<string, unknown>;
      return {
        TagId: row.TagId as string,
        Name: row.Name as string,
        ColorHex: row.ColorHex as string,
        FileCount: Number(row.FileCount ?? 0),
        CreatedAt: row.CreatedAt as string | undefined,
        CreatedBy: row.CreatedBy as string | undefined,
        ModifiedAt: row.ModifiedAt as string | undefined,
        ModifiedBy: row.ModifiedBy as string | undefined,
      };
    });
    tags.sort((a, b) => a.Name.localeCompare(b.Name));
    return { Tags: tags };
  }

  public async createTag(
    laboratory: Laboratory,
    userId: string,
    name: string,
    colorHex: string,
  ): Promise<LaboratoryDataTag> {
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.listTags(laboratoryId);
    const normalized = name.trim().toLowerCase();
    if (existing.Tags.some((t) => t.Name.trim().toLowerCase() === normalized)) {
      throw new Error('A tag with this name already exists');
    }

    const tagId = randomUUID();
    const now = new Date().toISOString();
    const item = {
      LaboratoryId: laboratoryId,
      Sk: skTag(tagId),
      TagId: tagId,
      Name: name.trim(),
      ColorHex: colorHex,
      FileCount: 0,
      CreatedAt: now,
      CreatedBy: userId,
      ModifiedAt: now,
      ModifiedBy: userId,
    };

    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
      ExpressionAttributeNames: {
        '#pk': 'LaboratoryId',
        '#sk': 'Sk',
      },
    });

    return {
      TagId: tagId,
      Name: name.trim(),
      ColorHex: colorHex,
      FileCount: 0,
      CreatedAt: now,
      CreatedBy: userId,
      ModifiedAt: now,
      ModifiedBy: userId,
    };
  }

  public async updateTag(
    laboratoryId: string,
    tagId: string,
    userId: string,
    name?: string,
    colorHex?: string,
  ): Promise<LaboratoryDataTag> {
    const existingRow = await this.getTagRow(laboratoryId, tagId);
    if (!existingRow) {
      throw new Error('Tag not found');
    }

    const nextName = name !== undefined ? name.trim() : existingRow.Name;
    const nextColor = colorHex !== undefined ? colorHex : existingRow.ColorHex;
    const now = new Date().toISOString();

    if (name !== undefined) {
      const existing = await this.listTags(laboratoryId);
      const normalized = nextName.toLowerCase();
      if (existing.Tags.some((t) => t.TagId !== tagId && t.Name.trim().toLowerCase() === normalized)) {
        throw new Error('A tag with this name already exists');
      }
    }

    const updated: LaboratoryDataTag = {
      ...existingRow,
      Name: nextName,
      ColorHex: nextColor,
      ModifiedAt: now,
      ModifiedBy: userId,
    };

    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          LaboratoryId: laboratoryId,
          Sk: skTag(tagId),
          TagId: tagId,
          Name: updated.Name,
          ColorHex: updated.ColorHex,
          FileCount: updated.FileCount,
          CreatedAt: existingRow.CreatedAt,
          CreatedBy: existingRow.CreatedBy,
          ModifiedAt: now,
          ModifiedBy: userId,
        },
        { removeUndefinedValues: true },
      ),
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      ExpressionAttributeNames: {
        '#pk': 'LaboratoryId',
        '#sk': 'Sk',
      },
    });

    return updated;
  }

  public async deleteTag(laboratoryId: string, tagId: string): Promise<void> {
    const tagRow = await this.getTagRow(laboratoryId, tagId);
    if (!tagRow) {
      return;
    }

    const gsiPk = gsi1PkForTag(laboratoryId, tagId);
    let startKey: Record<string, unknown> | undefined;

    const touchedRefs = new Set<string>();

    do {
      const page: QueryCommandOutput = await this.queryItems({
        TableName: TABLE_NAME,
        IndexName: GSI1_NAME,
        KeyConditionExpression: '#gpk = :gpk',
        ExpressionAttributeNames: { '#gpk': 'Gsi1Pk' },
        ExpressionAttributeValues: {
          ':gpk': { S: gsiPk },
        },
        ExclusiveStartKey: startKey as never,
      });

      for (const it of page.Items || []) {
        const row = unmarshall(it) as Record<string, string>;
        const ref = row.Gsi1Sk;
        touchedRefs.add(ref);

        await this.deleteItem({
          TableName: TABLE_NAME,
          Key: marshall({
            LaboratoryId: laboratoryId,
            Sk: row.Sk,
          }),
        });
      }

      startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    for (const ref of touchedRefs) {
      const fileRow = await this.getFileRow(laboratoryId, ref);
      if (!fileRow) continue;
      const nextIds = (fileRow.TagIds || []).filter((id) => id !== tagId);
      if (nextIds.length === 0) {
        await this.deleteItem({
          TableName: TABLE_NAME,
          Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
        });
      } else {
        await this.putItem({
          TableName: TABLE_NAME,
          Item: marshall(
            {
              LaboratoryId: laboratoryId,
              Sk: skFile(ref),
              S3Bucket: fileRow.S3Bucket,
              ObjectKey: fileRow.ObjectKey,
              TagIds: nextIds,
              ModifiedAt: new Date().toISOString(),
            },
            { removeUndefinedValues: true },
          ),
        });
      }
    }

    await this.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skTag(tagId) }),
    });
  }

  public async listFileTags(laboratoryId: string, bucket: string, keys: string[]): Promise<FileTagAssignment[]> {
    const out: FileTagAssignment[] = [];

    for (let i = 0; i < keys.length; i += 100) {
      const batchKeys = keys.slice(i, i + 100);
      const dynamoKeys = batchKeys.map((key) => ({
        LaboratoryId: laboratoryId,
        Sk: skFile(encodeS3ObjectRef(bucket, key)),
      }));

      const res: BatchGetItemCommandOutput = await this.batchGetItem({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: dynamoKeys.map((k) => marshall(k)),
          },
        },
      });

      const items = res.Responses?.[TABLE_NAME] || [];
      const bySk = new Map<string, string[]>();
      for (const item of items) {
        const row = unmarshall(item) as Record<string, unknown>;
        bySk.set(row.Sk as string, (row.TagIds as string[]) || []);
      }

      for (let j = 0; j < batchKeys.length; j++) {
        const key = batchKeys[j];
        const sk = dynamoKeys[j].Sk;
        out.push({ Key: key, TagIds: bySk.get(sk) || [] });
      }
    }

    return out;
  }

  public async listFilesByTag(
    laboratoryId: string,
    tagId: string,
    limit: number,
    cursor?: string,
  ): Promise<ListFilesByTagResponse> {
    const gsiPk = gsi1PkForTag(laboratoryId, tagId);
    const response: QueryCommandOutput = await this.queryItems({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: '#gpk = :gpk',
      ExpressionAttributeNames: { '#gpk': 'Gsi1Pk' },
      ExpressionAttributeValues: {
        ':gpk': { S: gsiPk },
      },
      Limit: limit,
      ExclusiveStartKey: cursor ? (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as never) : undefined,
    });

    const files: S3TaggedObjectRef[] = (response.Items || []).map((item) => {
      const row = unmarshall(item) as Record<string, string>;
      return { Bucket: row.S3Bucket, Key: row.ObjectKey };
    });

    const nextCursor = response.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(response.LastEvaluatedKey), 'utf8').toString('base64url')
      : undefined;

    return { Files: files, NextCursor: nextCursor };
  }

  public async applyTagsToFiles(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    keys: string[],
    addTagIds: string[],
    removeTagIds: string[],
  ): Promise<void> {
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);

    const add = addTagIds || [];
    const remove = removeTagIds || [];

    for (const tagId of add) {
      const t = await this.getTagRow(laboratoryId, tagId);
      if (!t) throw new Error(`Unknown tag: ${tagId}`);
    }
    for (const tagId of remove) {
      const t = await this.getTagRow(laboratoryId, tagId);
      if (!t) throw new Error(`Unknown tag: ${tagId}`);
    }

    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);
      const existing = await this.getFileRow(laboratoryId, ref);
      const tagIds = new Set<string>(existing?.TagIds || []);

      for (const rid of remove) {
        if (tagIds.delete(rid)) {
          await this.deleteMapIfExists(laboratoryId, rid, ref);
          await this.adjustTagFileCount(laboratoryId, rid, -1);
        }
      }

      for (const aid of add) {
        if (!tagIds.has(aid)) {
          tagIds.add(aid);
          await this.putMapRow(laboratoryId, aid, ref, bucket, key);
          await this.adjustTagFileCount(laboratoryId, aid, 1);
        }
      }

      const now = new Date().toISOString();
      if (tagIds.size === 0) {
        if (existing) {
          await this.deleteItem({
            TableName: TABLE_NAME,
            Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
          });
        }
      } else {
        await this.putItem({
          TableName: TABLE_NAME,
          Item: marshall(
            {
              LaboratoryId: laboratoryId,
              Sk: skFile(ref),
              S3Bucket: bucket,
              ObjectKey: key,
              TagIds: [...tagIds],
              ModifiedAt: now,
              ModifiedBy: userId,
            },
            { removeUndefinedValues: true },
          ),
        });
      }
    }
  }

  private async putMapRow(
    laboratoryId: string,
    tagId: string,
    ref: string,
    bucket: string,
    key: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          LaboratoryId: laboratoryId,
          Sk: skMap(tagId, ref),
          Gsi1Pk: gsi1PkForTag(laboratoryId, tagId),
          Gsi1Sk: ref,
          S3Bucket: bucket,
          ObjectKey: key,
          TagId: tagId,
          CreatedAt: now,
        },
        { removeUndefinedValues: true },
      ),
    });
  }

  private async deleteMapIfExists(laboratoryId: string, tagId: string, ref: string): Promise<void> {
    await this.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skMap(tagId, ref) }),
    });
  }

  private async adjustTagFileCount(laboratoryId: string, tagId: string, delta: number): Promise<void> {
    const row = await this.getTagRow(laboratoryId, tagId);
    if (!row) return;
    const next = Math.max(0, (row.FileCount || 0) + delta);
    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          LaboratoryId: laboratoryId,
          Sk: skTag(tagId),
          TagId: row.TagId,
          Name: row.Name,
          ColorHex: row.ColorHex,
          FileCount: next,
          CreatedAt: row.CreatedAt,
          CreatedBy: row.CreatedBy,
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: row.ModifiedBy,
        },
        { removeUndefinedValues: true },
      ),
    });
  }

  private async getTagRow(laboratoryId: string, tagId: string): Promise<LaboratoryDataTag | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skTag(tagId) }),
    });
    if (!res.Item) return null;
    const row = unmarshall(res.Item) as Record<string, unknown>;
    return {
      TagId: row.TagId as string,
      Name: row.Name as string,
      ColorHex: row.ColorHex as string,
      FileCount: Number(row.FileCount ?? 0),
      CreatedAt: row.CreatedAt as string | undefined,
      CreatedBy: row.CreatedBy as string | undefined,
      ModifiedAt: row.ModifiedAt as string | undefined,
      ModifiedBy: row.ModifiedBy as string | undefined,
    };
  }

  private async getFileRow(
    laboratoryId: string,
    ref: string,
  ): Promise<{ TagIds: string[]; S3Bucket: string; ObjectKey: string } | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
    });
    if (!res.Item) return null;
    const row = unmarshall(res.Item) as Record<string, unknown>;
    return {
      TagIds: (row.TagIds as string[]) || [],
      S3Bucket: row.S3Bucket as string,
      ObjectKey: row.ObjectKey as string,
    };
  }
}
