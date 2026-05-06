import { randomUUID } from 'crypto';
import { BatchGetItemCommandOutput, QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  FileTagAssignment,
  LaboratoryDataTag,
  LaboratoryDataTagKind,
  ListFilesByTagResponse,
  ListLaboratoryDataTagsResponse,
  S3TaggedObjectRef,
  WorkflowPlatform,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { DynamoDBService } from '../dynamodb-service';

const TABLE_NAME = `${process.env.NAME_PREFIX}-laboratory-data-tagging-table`;
const GSI1_NAME = 'Gsi1Pk_Index';

/**
 * Deterministic palette used for auto-assigned workflow tag colors. Mirrors the
 * preset palette exposed in the data tagging UI so workflow chips look at home
 * next to user-created tags.
 */
const WORKFLOW_TAG_COLOR_PALETTE = ['#5B4FD4', '#85B7EB', '#F09595', '#97C459', '#ED93B1', '#EF9F27', '#B4B2A9'];

/** 2^32 — wraps the running hash to an unsigned 32-bit range without bitwise operators (satisfies no-bitwise lint). */
const UINT32_RANGE = 2 ** 32;

function pickWorkflowTagColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % UINT32_RANGE;
  }
  return WORKFLOW_TAG_COLOR_PALETTE[h % WORKFLOW_TAG_COLOR_PALETTE.length];
}

function workflowGsiSk(platform: WorkflowPlatform, externalId: string, versionName?: string): string {
  return `${platform}#${externalId}#${versionName ?? ''}`;
}

function workflowGsiPk(laboratoryId: string): string {
  return `${laboratoryId}#WORKFLOW`;
}

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

    const tags: LaboratoryDataTag[] = (response.Items || []).map((item) =>
      this.tagRowToModel(unmarshall(item) as Record<string, unknown>),
    );
    tags.sort((a, b) => a.Name.localeCompare(b.Name));
    return { Tags: tags };
  }

  /** Converts a raw TAG row from DynamoDB into the shared LaboratoryDataTag model. */
  private tagRowToModel(row: Record<string, unknown>): LaboratoryDataTag {
    const rawKind = typeof row.Kind === 'string' ? (row.Kind as string) : 'standard';
    const kind: LaboratoryDataTagKind =
      rawKind === 'batch' ? 'batch' : rawKind === 'workflow' ? 'workflow' : 'standard';
    return {
      TagId: row.TagId as string,
      Name: row.Name as string,
      ColorHex: row.ColorHex as string,
      ...(kind !== 'standard' ? { Kind: kind } : {}),
      FileCount: Number(row.FileCount ?? 0),
      ...(kind === 'workflow'
        ? {
            Platform: row.Platform as WorkflowPlatform | undefined,
            WorkflowExternalId: row.WorkflowExternalId as string | undefined,
            WorkflowVersionName: row.WorkflowVersionName as string | undefined,
          }
        : {}),
      CreatedAt: row.CreatedAt as string | undefined,
      CreatedBy: row.CreatedBy as string | undefined,
      ModifiedAt: row.ModifiedAt as string | undefined,
      ModifiedBy: row.ModifiedBy as string | undefined,
    };
  }

  public async createTag(
    laboratory: Laboratory,
    userId: string,
    name: string,
    colorHex: string,
    kind: LaboratoryDataTagKind = 'standard',
  ): Promise<LaboratoryDataTag> {
    if (kind === 'workflow') {
      throw new Error('Workflow tags cannot be created directly; use getOrCreateWorkflowTag.');
    }
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.listTags(laboratoryId);
    const normalized = name.trim().toLowerCase();
    // Workflow tags are namespaced by (Platform, WorkflowExternalId, WorkflowVersionName) and are
    // allowed to share display names with user-created tags, so they are excluded from the
    // user-tag uniqueness check.
    if (
      existing.Tags.some((t) => (t.Kind ?? 'standard') !== 'workflow' && t.Name.trim().toLowerCase() === normalized)
    ) {
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
      ...(kind === 'batch' ? { Kind: 'batch' as const } : {}),
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
      ...(kind === 'batch' ? { Kind: 'batch' as const } : {}),
      FileCount: 0,
      CreatedAt: now,
      CreatedBy: userId,
      ModifiedAt: now,
      ModifiedBy: userId,
    };
  }

  /**
   * Workflow tags are auto-created when a run is launched (or backfilled). Each unique
   * (laboratoryId, platform, workflowExternalId, workflowVersionName) tuple gets its own tag,
   * looked up via GSI `Gsi1Pk_Index` so we don't have to scan the partition.
   */
  public async getOrCreateWorkflowTag(
    laboratory: Laboratory,
    userId: string,
    args: {
      platform: WorkflowPlatform;
      externalId: string;
      versionName?: string;
      name: string;
    },
  ): Promise<LaboratoryDataTag> {
    const laboratoryId = laboratory.LaboratoryId;
    const gpk = workflowGsiPk(laboratoryId);
    const gsk = workflowGsiSk(args.platform, args.externalId, args.versionName);

    const existing: QueryCommandOutput = await this.queryItems({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: '#gpk = :gpk AND #gsk = :gsk',
      ExpressionAttributeNames: { '#gpk': 'Gsi1Pk', '#gsk': 'Gsi1Sk' },
      ExpressionAttributeValues: { ':gpk': { S: gpk }, ':gsk': { S: gsk } },
      Limit: 1,
    });

    if ((existing.Items || []).length > 0) {
      return this.tagRowToModel(unmarshall(existing.Items![0]) as Record<string, unknown>);
    }

    const tagId = randomUUID();
    const now = new Date().toISOString();
    const trimmedName = args.name.trim() || args.externalId;
    const colorHex = pickWorkflowTagColor(`${args.platform}#${args.externalId}`);

    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          LaboratoryId: laboratoryId,
          Sk: skTag(tagId),
          TagId: tagId,
          Name: trimmedName,
          ColorHex: colorHex,
          Kind: 'workflow',
          Platform: args.platform,
          WorkflowExternalId: args.externalId,
          WorkflowVersionName: args.versionName ?? '',
          FileCount: 0,
          Gsi1Pk: gpk,
          Gsi1Sk: gsk,
          CreatedAt: now,
          CreatedBy: userId,
          ModifiedAt: now,
          ModifiedBy: userId,
        },
        { removeUndefinedValues: true },
      ),
      ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
      ExpressionAttributeNames: { '#pk': 'LaboratoryId', '#sk': 'Sk' },
    });

    return {
      TagId: tagId,
      Name: trimmedName,
      ColorHex: colorHex,
      Kind: 'workflow',
      Platform: args.platform,
      WorkflowExternalId: args.externalId,
      WorkflowVersionName: args.versionName ?? '',
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
    if (existingRow.Kind === 'workflow') {
      throw new Error('Workflow tags are auto-managed and cannot be edited');
    }

    const nextName = name !== undefined ? name.trim() : existingRow.Name;
    const nextColor = colorHex !== undefined ? colorHex : existingRow.ColorHex;
    const now = new Date().toISOString();

    if (name !== undefined) {
      const existing = await this.listTags(laboratoryId);
      const normalized = nextName.toLowerCase();
      if (
        existing.Tags.some(
          (t) =>
            t.TagId !== tagId && (t.Kind ?? 'standard') !== 'workflow' && t.Name.trim().toLowerCase() === normalized,
        )
      ) {
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
          ...(existingRow.Kind === 'batch' ? { Kind: 'batch' as const } : {}),
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
    const { batchTagIds, workflowTagIds } = await this.getKindIndexedTagIds(laboratoryId);

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
        const rawIds = bySk.get(sk) || [];
        const standard: string[] = [];
        const workflowIds: string[] = [];
        let batchTagId: string | undefined;
        for (const id of rawIds) {
          if (batchTagIds.has(id)) {
            batchTagId = id;
          } else if (workflowTagIds.has(id)) {
            workflowIds.push(id);
          } else {
            standard.push(id);
          }
        }
        out.push({
          Key: key,
          TagIds: standard,
          WorkflowTagIds: workflowIds,
          ...(batchTagId ? { BatchTagId: batchTagId } : {}),
        });
      }
    }

    return out;
  }

  /**
   * Idempotently associate a set of input file keys with a workflow tag. The keys must lie under
   * the laboratory prefix; bucket validation is performed by the caller via `assertBucketMatchesLab`.
   * Re-applying the same workflow tag to a file is a no-op (no FileCount drift, no duplicate MAP rows).
   */
  public async applyWorkflowToFiles(
    laboratory: Laboratory,
    userId: string,
    workflowTagId: string,
    bucket: string,
    keys: string[],
  ): Promise<void> {
    if (!keys.length) return;
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);

    const tagRow = await this.getTagRow(laboratoryId, workflowTagId);
    if (!tagRow) throw new Error(`Unknown tag: ${workflowTagId}`);
    if (tagRow.Kind !== 'workflow') {
      throw new Error('applyWorkflowToFiles can only be used with workflow-kind tags');
    }

    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);
      const existing = await this.getFileRow(laboratoryId, ref);
      const tagIds = new Set<string>(existing?.TagIds || []);

      if (tagIds.has(workflowTagId)) continue;

      tagIds.add(workflowTagId);
      await this.putMapRow(laboratoryId, workflowTagId, ref, bucket, key);
      await this.adjustTagFileCount(laboratoryId, workflowTagId, 1);

      const now = new Date().toISOString();
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

    const batchTagIds = await this.getBatchTagIdSet(laboratoryId);
    const batchAdds = add.filter((id) => batchTagIds.has(id));
    if (batchAdds.length > 1) {
      throw new Error('Cannot add more than one batch tag at a time');
    }

    for (const tagId of add) {
      const t = await this.getTagRow(laboratoryId, tagId);
      if (!t) throw new Error(`Unknown tag: ${tagId}`);
      if (t.Kind === 'workflow') {
        throw new Error('Workflow tags are auto-managed and cannot be added through this API');
      }
    }
    for (const tagId of remove) {
      const t = await this.getTagRow(laboratoryId, tagId);
      if (!t) throw new Error(`Unknown tag: ${tagId}`);
      if (t.Kind === 'workflow') {
        throw new Error('Workflow tags are auto-managed and cannot be removed through this API');
      }
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

      if (batchAdds.length === 1) {
        for (const bid of [...tagIds]) {
          if (batchTagIds.has(bid)) {
            tagIds.delete(bid);
            await this.deleteMapIfExists(laboratoryId, bid, ref);
            await this.adjustTagFileCount(laboratoryId, bid, -1);
          }
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

  /**
   * Sets batch assignment for files: at most one batch per file. Does not modify standard tags.
   */
  public async setBatchForFiles(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    keys: string[],
    mode: { type: 'clear' } | { type: 'existing'; batchTagId: string } | { type: 'new'; name: string },
  ): Promise<void> {
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);

    let targetBatchId: string | undefined;
    if (mode.type === 'new') {
      const created = await this.createTag(laboratory, userId, mode.name, '#5B4FD4', 'batch');
      targetBatchId = created.TagId;
    } else if (mode.type === 'existing') {
      const row = await this.getTagRow(laboratoryId, mode.batchTagId);
      if (!row) throw new Error(`Unknown batch: ${mode.batchTagId}`);
      if ((row.Kind ?? 'standard') !== 'batch') throw new Error('Tag is not a batch');
      targetBatchId = mode.batchTagId;
    }

    const batchTagIds = await this.getBatchTagIdSet(laboratoryId);

    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);
      const existing = await this.getFileRow(laboratoryId, ref);
      const tagIds = new Set<string>(existing?.TagIds || []);

      for (const bid of [...tagIds]) {
        if (batchTagIds.has(bid)) {
          tagIds.delete(bid);
          await this.deleteMapIfExists(laboratoryId, bid, ref);
          await this.adjustTagFileCount(laboratoryId, bid, -1);
        }
      }

      if (targetBatchId) {
        if (!tagIds.has(targetBatchId)) {
          tagIds.add(targetBatchId);
          await this.putMapRow(laboratoryId, targetBatchId, ref, bucket, key);
          await this.adjustTagFileCount(laboratoryId, targetBatchId, 1);
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

  private async getBatchTagIdSet(laboratoryId: string): Promise<Set<string>> {
    const { Tags } = await this.listTags(laboratoryId);
    return new Set(Tags.filter((t) => (t.Kind ?? 'standard') === 'batch').map((t) => t.TagId));
  }

  /**
   * Single-pass tag listing that returns the batch and workflow tag id sets used to
   * partition file rows in `listFileTags`. Avoids two `listTags` round-trips on hot paths.
   */
  private async getKindIndexedTagIds(
    laboratoryId: string,
  ): Promise<{ batchTagIds: Set<string>; workflowTagIds: Set<string> }> {
    const { Tags } = await this.listTags(laboratoryId);
    const batchTagIds = new Set<string>();
    const workflowTagIds = new Set<string>();
    for (const t of Tags) {
      const kind = t.Kind ?? 'standard';
      if (kind === 'batch') batchTagIds.add(t.TagId);
      else if (kind === 'workflow') workflowTagIds.add(t.TagId);
    }
    return { batchTagIds, workflowTagIds };
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
    // UpdateItem (rather than putItem) so we don't accidentally drop kind-specific attributes
    // (Platform/WorkflowExternalId/WorkflowVersionName) or GSI keys on workflow-kind tag rows.
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skTag(tagId) }),
      UpdateExpression: 'SET FileCount = :n, ModifiedAt = :ma',
      ExpressionAttributeValues: marshall({
        ':n': next,
        ':ma': new Date().toISOString(),
      }),
    });
  }

  private async getTagRow(laboratoryId: string, tagId: string): Promise<LaboratoryDataTag | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skTag(tagId) }),
    });
    if (!res.Item) return null;
    return this.tagRowToModel(unmarshall(res.Item) as Record<string, unknown>);
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
