import { randomUUID } from 'crypto';
import {
  BatchGetItemCommandOutput,
  ConditionalCheckFailedException,
  QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  FileTagAssignment,
  LaboratoryDataTag,
  LaboratoryDataTagKind,
  LaboratoryRunUsageSummary,
  ListFilesByTagResponse,
  ListLaboratoryDataTagsResponse,
  S3TaggedObjectRef,
  WorkflowPlatform,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { v5 as uuidv5 } from 'uuid';
import { DynamoDBService } from '../dynamodb-service';

const TABLE_NAME = `${process.env.NAME_PREFIX}-laboratory-data-tagging-table`;
const GSI1_NAME = 'Gsi1Pk_Index';

/** Namespace UUID for v5 workflow tag ids (stable per lab + platform + workflow identity). */
const WORKFLOW_TAG_ID_NAMESPACE = 'a3d8f7e2-4c1b-5d6e-9f8a-0b1c2d3e4f5a';

function isConditionalCheckFailed(e: unknown): boolean {
  return (
    e instanceof ConditionalCheckFailedException ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'ConditionalCheckFailedException')
  );
}

function deterministicWorkflowTagId(
  laboratoryId: string,
  platform: WorkflowPlatform,
  externalId: string,
  versionName: string,
): string {
  return uuidv5(`${laboratoryId}\u0000${platform}\u0000${externalId}\u0000${versionName}`, WORKFLOW_TAG_ID_NAMESPACE);
}

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

/**
 * Inverse of {@link workflowGsiSk}. Workflow TAG rows store identity on `Gsi1Sk` as
 * `{platform}#{externalId}#{version}` so we can recover Kind/Platform when legacy rows
 * omitted scalar attributes.
 */
function parseWorkflowIdentityFromGsiSk(gsk: unknown): {
  Platform: WorkflowPlatform;
  WorkflowExternalId: string;
  WorkflowVersionName: string;
} | null {
  if (typeof gsk !== 'string' || !gsk.length) {
    return null;
  }
  const platforms: WorkflowPlatform[] = ['AWS HealthOmics', 'Seqera Cloud'];
  for (const platform of platforms) {
    const prefix = `${platform}#`;
    if (!gsk.startsWith(prefix)) {
      continue;
    }
    const tail = gsk.slice(prefix.length);
    const i = tail.indexOf('#');
    if (i === -1) {
      return { Platform: platform, WorkflowExternalId: tail, WorkflowVersionName: '' };
    }
    return {
      Platform: platform,
      WorkflowExternalId: tail.slice(0, i),
      WorkflowVersionName: tail.slice(i + 1),
    };
  }
  return null;
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
    const tags: LaboratoryDataTag[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
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
        /** Strongly consistent read so tag metadata matches FILE# rows updated in the same session (e.g. workflow seeding). */
        ConsistentRead: true,
        ...(startKey ? { ExclusiveStartKey: startKey as never } : {}),
      });

      for (const item of response.Items || []) {
        tags.push(this.tagRowToModel(unmarshall(item) as Record<string, unknown>));
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    tags.sort((a, b) => a.Name.localeCompare(b.Name));
    return { Tags: tags };
  }

  /** Converts a raw TAG row from DynamoDB into the shared LaboratoryDataTag model. */
  private tagRowToModel(row: Record<string, unknown>): LaboratoryDataTag {
    /** Set on workflow TAG rows; Kind/Platform scalars may be missing on legacy or partially-projected items. */
    const gsiSkParsed = parseWorkflowIdentityFromGsiSk(row.Gsi1Sk ?? row.gsi1Sk);

    const rawKindAttr = row.Kind ?? row.kind;
    const rawKind = typeof rawKindAttr === 'string' ? rawKindAttr : 'standard';
    let kind: LaboratoryDataTagKind = rawKind === 'batch' ? 'batch' : rawKind === 'workflow' ? 'workflow' : 'standard';
    /** Workflow rows always carry platform + external id; infer Kind if an older row omitted it. */
    const hasWorkflowIdentity =
      typeof row.Platform === 'string' &&
      row.Platform.length > 0 &&
      typeof row.WorkflowExternalId === 'string' &&
      (row.WorkflowExternalId as string).length > 0;
    if (kind !== 'batch' && hasWorkflowIdentity) {
      kind = 'workflow';
    }
    /** Workflow tags are indexed under Gsi1Pk `{LaboratoryId}#WORKFLOW` — infer Kind when scalars were omitted. */
    const laboratoryId = row.LaboratoryId as string | undefined;
    const gsi1Pk = row.Gsi1Pk as string | undefined;
    const workflowIndexTag =
      typeof laboratoryId === 'string' &&
      laboratoryId.length > 0 &&
      typeof gsi1Pk === 'string' &&
      gsi1Pk === workflowGsiPk(laboratoryId);
    /**
     * Also infer from `Gsi1Sk` alone: some stored rows retain the workflow identity sort key but not Gsi1Pk/Kind
     * (e.g. partial updates). Pattern matches {@link workflowGsiSk} output only for workflow tags.
     */
    if (kind !== 'batch' && (workflowIndexTag || gsiSkParsed)) {
      kind = 'workflow';
    }

    let platform = row.Platform as WorkflowPlatform | undefined;
    let workflowExternalId = row.WorkflowExternalId as string | undefined;
    let workflowVersionName = row.WorkflowVersionName as string | undefined;
    if (kind === 'workflow' && (!platform || !workflowExternalId) && gsiSkParsed) {
      platform = platform ?? gsiSkParsed.Platform;
      workflowExternalId = workflowExternalId ?? gsiSkParsed.WorkflowExternalId;
      workflowVersionName = workflowVersionName ?? gsiSkParsed.WorkflowVersionName;
    }

    return {
      TagId: row.TagId as string,
      Name: row.Name as string,
      ColorHex: row.ColorHex as string,
      ...(kind !== 'standard' ? { Kind: kind } : {}),
      FileCount: Number(row.FileCount ?? 0),
      ...(kind === 'workflow'
        ? {
            Platform: platform,
            WorkflowExternalId: workflowExternalId,
            WorkflowVersionName: workflowVersionName,
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
   * Returns an existing workflow tag for the identity tuple, or null if none exists.
   * Does not create a tag (use {@link getOrCreateWorkflowTag} for that).
   */
  public async findWorkflowTagByIdentity(
    laboratoryId: string,
    args: {
      platform: WorkflowPlatform;
      externalId: string;
      versionName?: string;
    },
  ): Promise<LaboratoryDataTag | null> {
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
    if (!(existing.Items || []).length) {
      return null;
    }
    return this.tagRowToModel(unmarshall(existing.Items![0]) as Record<string, unknown>);
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
    const existing = await this.findWorkflowTagByIdentity(laboratoryId, args);
    if (existing) {
      return existing;
    }

    const versionKey = args.versionName ?? '';
    const tagId = deterministicWorkflowTagId(laboratoryId, args.platform, args.externalId, versionKey);
    const existingByPk = await this.getTagRow(laboratoryId, tagId);
    if (existingByPk) {
      const isWorkflow =
        existingByPk.Kind === 'workflow' || !!(existingByPk.Platform && existingByPk.WorkflowExternalId);
      if (isWorkflow) {
        return existingByPk;
      }
      throw new Error('Workflow tag id collision with an existing non-workflow tag');
    }

    const now = new Date().toISOString();
    const trimmedName = args.name.trim() || args.externalId;
    const colorHex = pickWorkflowTagColor(`${args.platform}#${args.externalId}`);
    const gpk = workflowGsiPk(laboratoryId);
    const gsk = workflowGsiSk(args.platform, args.externalId, args.versionName);

    try {
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
            WorkflowVersionName: versionKey,
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
    } catch (e: unknown) {
      if (isConditionalCheckFailed(e)) {
        const won = await this.findWorkflowTagByIdentity(laboratoryId, args);
        if (won) {
          return won;
        }
        const row = await this.getTagRow(laboratoryId, tagId);
        if (row) {
          return row;
        }
      }
      throw e;
    }

    return {
      TagId: tagId,
      Name: trimmedName,
      ColorHex: colorHex,
      Kind: 'workflow',
      Platform: args.platform,
      WorkflowExternalId: args.externalId,
      WorkflowVersionName: versionKey,
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
      const hasUsages = !!fileRow.LaboratoryRunUsages && Object.keys(fileRow.LaboratoryRunUsages).length > 0;
      // Preserve the FILE# row whenever per-run usage history is recorded against it; otherwise
      // deleting it would lose the analysis history surfaced in the data collections UI.
      if (nextIds.length === 0 && !hasUsages) {
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
              ...(hasUsages ? { LaboratoryRunUsages: fileRow.LaboratoryRunUsages } : {}),
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

  /**
   * For tag ids present on files but missing from the listTags-derived sets (e.g. eventual
   * consistency right after workflow tagging), load TAG# rows via BatchGetItem and add ids
   * to batchTagIds / workflowTagIds so listFileTags partitions correctly.
   */
  private async hydrateKindSetsFromTagIds(
    laboratoryId: string,
    tagIds: Iterable<string>,
    batchTagIds: Set<string>,
    workflowTagIds: Set<string>,
  ): Promise<void> {
    const toResolve = [...new Set(tagIds)].filter((id) => !batchTagIds.has(id) && !workflowTagIds.has(id));
    if (!toResolve.length) return;

    for (let i = 0; i < toResolve.length; i += 100) {
      const chunk = toResolve.slice(i, i + 100);
      const res: BatchGetItemCommandOutput = await this.batchGetItem({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: chunk.map((tagId) =>
              marshall({
                LaboratoryId: laboratoryId,
                Sk: skTag(tagId),
              }),
            ),
            /** Strongly consistent so Kind/workflow metadata is visible right after PutItem on TAG# rows. */
            ConsistentRead: true,
          },
        },
      });
      for (const item of res.Responses?.[TABLE_NAME] || []) {
        const tag = this.tagRowToModel(unmarshall(item) as Record<string, unknown>);
        const isWorkflow = tag.Kind === 'workflow' || !!(tag.Platform && tag.WorkflowExternalId);
        if (tag.Kind === 'batch') {
          batchTagIds.add(tag.TagId);
        } else if (isWorkflow) {
          workflowTagIds.add(tag.TagId);
        }
      }
    }
  }

  public async listFileTags(laboratoryId: string, bucket: string, keys: string[]): Promise<FileTagAssignment[]> {
    const out: FileTagAssignment[] = [];
    const { batchTagIds, workflowTagIds } = await this.getKindIndexedTagIds(laboratoryId);
    const batchTagIdsMutable = new Set(batchTagIds);
    const workflowTagIdsMutable = new Set(workflowTagIds);

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
            /** Strongly consistent with workflow writes (FILE# + TAG# in the same request path). */
            ConsistentRead: true,
          },
        },
      });

      const items = res.Responses?.[TABLE_NAME] || [];
      const bySk = new Map<string, string[]>();
      const usagesBySk = new Map<string, Record<string, LaboratoryRunUsageSummary>>();
      const chunkTagIds = new Set<string>();
      for (const item of items) {
        const row = unmarshall(item) as Record<string, unknown>;
        const ids = (row.TagIds as string[]) || [];
        bySk.set(row.Sk as string, ids);
        for (const id of ids) chunkTagIds.add(id);
        const usages = row.LaboratoryRunUsages as Record<string, LaboratoryRunUsageSummary> | undefined;
        if (usages && Object.keys(usages).length > 0) {
          usagesBySk.set(row.Sk as string, usages);
        }
      }

      await this.hydrateKindSetsFromTagIds(laboratoryId, chunkTagIds, batchTagIdsMutable, workflowTagIdsMutable);

      for (let j = 0; j < batchKeys.length; j++) {
        const key = batchKeys[j];
        const sk = dynamoKeys[j].Sk;
        const rawIds = bySk.get(sk) || [];
        const standard: string[] = [];
        const workflowIds: string[] = [];
        let batchTagId: string | undefined;
        for (const id of rawIds) {
          if (batchTagIdsMutable.has(id)) {
            batchTagId = id;
          } else if (workflowTagIdsMutable.has(id)) {
            workflowIds.push(id);
          } else {
            standard.push(id);
          }
        }
        const usagesMap = usagesBySk.get(sk);
        const usageList = usagesMap
          ? Object.values(usagesMap).sort((a, b) => (b.RunCreatedAt || '').localeCompare(a.RunCreatedAt || ''))
          : undefined;
        out.push({
          Key: key,
          TagIds: standard,
          WorkflowTagIds: workflowIds,
          ...(batchTagId ? { BatchTagId: batchTagId } : {}),
          ...(usageList && usageList.length ? { LaboratoryRunUsages: usageList } : {}),
        });
      }
    }

    return out;
  }

  /**
   * Idempotently associate a set of input file keys with a workflow tag. The keys must lie under
   * the laboratory prefix; bucket validation is performed by the caller via `assertBucketMatchesLab`.
   * Re-applying the same workflow tag to a file is a no-op (no FileCount drift, no duplicate MAP rows).
   *
   * Uses an atomic DynamoDB `UpdateItem` (list_append + NOT contains) so concurrent launches cannot
   * drop each other's workflow ids on the same FILE# row; MAP rows and FileCount are updated only
   * when a new MAP link is inserted.
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
    const isWorkflow = tagRow.Kind === 'workflow' || !!(tagRow.Platform && tagRow.WorkflowExternalId);
    if (!isWorkflow) {
      throw new Error('applyWorkflowToFiles can only be used with workflow-kind tags');
    }

    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);
      await this.applyWorkflowToSingleFileKey(laboratoryId, userId, workflowTagId, bucket, key, ref);
    }
  }

  /**
   * Atomically appends the workflow tag id to the file row's TagIds list when absent, then
   * ensures a MAP# row exists (insert-only). Heals a missing MAP row when the file row already
   * lists the workflow (e.g. partial failure or client retry).
   */
  private async applyWorkflowToSingleFileKey(
    laboratoryId: string,
    userId: string,
    workflowTagId: string,
    bucket: string,
    key: string,
    ref: string,
  ): Promise<void> {
    const ensureMapAndCount = async (): Promise<void> => {
      const mapInserted = await this.putMapRowIfAbsent(laboratoryId, workflowTagId, ref, bucket, key);
      if (mapInserted) {
        await this.adjustTagFileCount(laboratoryId, workflowTagId, 1);
      }
    };

    const existing = await this.getFileRow(laboratoryId, ref);
    if (existing?.TagIds?.includes(workflowTagId)) {
      await ensureMapAndCount();
      return;
    }

    const now = new Date().toISOString();
    try {
      await this.updateItem({
        TableName: TABLE_NAME,
        Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
        UpdateExpression:
          'SET #tid = list_append(if_not_exists(#tid, :empty), :one), ModifiedBy = :mb, ModifiedAt = :ma, #sb = if_not_exists(#sb, :bucket), #ok = if_not_exists(#ok, :objectKey)',
        ExpressionAttributeNames: {
          '#tid': 'TagIds',
          '#sb': 'S3Bucket',
          '#ok': 'ObjectKey',
        },
        ExpressionAttributeValues: marshall({
          ':empty': [],
          ':one': [workflowTagId],
          ':mb': userId,
          ':ma': now,
          ':bucket': bucket,
          ':objectKey': key,
          ':wfElem': workflowTagId,
        }),
        ConditionExpression: 'attribute_not_exists(#tid) OR NOT contains(#tid, :wfElem)',
      });
    } catch (e: unknown) {
      if (isConditionalCheckFailed(e)) {
        await ensureMapAndCount();
        return;
      }
      throw e;
    }

    await ensureMapAndCount();
  }

  /**
   * Idempotently records a laboratory run's usage of a set of input file keys. Each (file, RunId)
   * pair becomes an entry under the FILE# row's `LaboratoryRunUsages` map so the data collections
   * UI can render a per-file analysis history regardless of whether the run participated in
   * workflow tagging (i.e. `WorkflowExternalId` may be missing). Re-invoking with the same RunId
   * is a no-op for already-recorded entries.
   *
   * The FILE# row may not exist yet (e.g. a run with no workflow tag) — the UpdateItem also seeds
   * S3Bucket / ObjectKey when they're absent so the row carries enough metadata to be discovered
   * later by `listFileTags`.
   */
  public async recordLaboratoryRunInputUsage(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    keys: string[],
    summary: LaboratoryRunUsageSummary,
  ): Promise<void> {
    if (!keys.length) return;
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);

    const now = new Date().toISOString();
    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);

      // Step 1: ensure the FILE# row exists with a map at `LaboratoryRunUsages`. UpdateItem with
      // a SET on a nested path requires the parent map to exist, so we initialise it here first.
      // S3Bucket / ObjectKey are seeded only when absent so this never clobbers data from other
      // write paths (e.g. workflow tagging or user tag assignments).
      await this.updateItem({
        TableName: TABLE_NAME,
        Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
        UpdateExpression:
          'SET #lru = if_not_exists(#lru, :emptyMap), #sb = if_not_exists(#sb, :bucket), #ok = if_not_exists(#ok, :objectKey)',
        ExpressionAttributeNames: {
          '#lru': 'LaboratoryRunUsages',
          '#sb': 'S3Bucket',
          '#ok': 'ObjectKey',
        },
        ExpressionAttributeValues: marshall({
          ':emptyMap': {},
          ':bucket': bucket,
          ':objectKey': key,
        }),
      });

      // Step 2: insert this run's usage entry only when the RunId is not already present, making
      // repeat invocations (retries, backfill) idempotent without overwriting an earlier summary.
      try {
        await this.updateItem({
          TableName: TABLE_NAME,
          Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
          UpdateExpression: 'SET #lru.#rid = :summary, ModifiedBy = :mb, ModifiedAt = :ma',
          ExpressionAttributeNames: {
            '#lru': 'LaboratoryRunUsages',
            '#rid': summary.RunId,
          },
          ExpressionAttributeValues: marshall(
            {
              ':summary': summary,
              ':mb': userId,
              ':ma': now,
            },
            { removeUndefinedValues: true },
          ),
          ConditionExpression: 'attribute_not_exists(#lru.#rid)',
        });
      } catch (e: unknown) {
        if (isConditionalCheckFailed(e)) {
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Removes the given `RunId` entries from each file's `LaboratoryRunUsages` map. Used by
   * maintenance flows (seed reset, run deletion) that need to undo run history without
   * touching unrelated tags. If a FILE# row ends up with no tags **and** no usages after the
   * removal, the row itself is deleted to keep the table clean.
   *
   * `runIdToInputKeys` is the run's recorded input keys (or any superset) so we know which
   * `FILE#` rows could possibly carry an entry for the given `RunId`; the per-file update
   * gracefully no-ops when the row or entry is already gone (e.g. concurrent cleanups).
   */
  public async removeLaboratoryRunUsageForRunIds(
    laboratory: Laboratory,
    bucket: string,
    runIdToInputKeys: Record<string, string[]>,
  ): Promise<void> {
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);

    for (const [runId, rawKeys] of Object.entries(runIdToInputKeys)) {
      const keys = (rawKeys || []).filter((k): k is string => typeof k === 'string' && k.length > 0);
      for (const key of keys) {
        // Silently ignore keys outside this lab — defensive, but reachable if a seed script writes
        // mixed lab keys onto a run record.
        if (!key.startsWith(`${laboratory.OrganizationId}/${laboratoryId}/`)) continue;
        const ref = encodeS3ObjectRef(bucket, key);

        try {
          await this.updateItem({
            TableName: TABLE_NAME,
            Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
            UpdateExpression: 'REMOVE #lru.#rid',
            ExpressionAttributeNames: {
              '#lru': 'LaboratoryRunUsages',
              '#rid': runId,
            },
            // Only act on FILE# rows that actually carry this RunId. Avoids creating empty maps
            // on unrelated files, and keeps the operation idempotent under retries.
            ConditionExpression: 'attribute_exists(#lru) AND attribute_exists(#lru.#rid)',
          });
        } catch (e: unknown) {
          if (isConditionalCheckFailed(e)) {
            continue;
          }
          throw e;
        }

        // Re-read the row to decide whether it can be deleted entirely. The row may have other
        // tags, batch assignments, or remaining run usages — only delete when both TagIds and
        // LaboratoryRunUsages are empty.
        const after = await this.getFileRow(laboratoryId, ref);
        if (!after) continue;
        const hasTags = (after.TagIds || []).length > 0;
        const hasUsages = !!after.LaboratoryRunUsages && Object.keys(after.LaboratoryRunUsages).length > 0;
        if (!hasTags && !hasUsages) {
          await this.deleteItem({
            TableName: TABLE_NAME,
            Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
          });
        }
      }
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
      const hasUsages = !!existing?.LaboratoryRunUsages && Object.keys(existing.LaboratoryRunUsages).length > 0;
      if (tagIds.size === 0) {
        if (existing && !hasUsages) {
          await this.deleteItem({
            TableName: TABLE_NAME,
            Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
          });
        } else if (existing && hasUsages) {
          // Preserve run history even when all tags are removed from this file.
          await this.putItem({
            TableName: TABLE_NAME,
            Item: marshall(
              {
                LaboratoryId: laboratoryId,
                Sk: skFile(ref),
                S3Bucket: bucket,
                ObjectKey: key,
                TagIds: [],
                LaboratoryRunUsages: existing.LaboratoryRunUsages,
                ModifiedAt: now,
                ModifiedBy: userId,
              },
              { removeUndefinedValues: true },
            ),
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
              ...(hasUsages ? { LaboratoryRunUsages: existing!.LaboratoryRunUsages } : {}),
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
      const hasUsages = !!existing?.LaboratoryRunUsages && Object.keys(existing.LaboratoryRunUsages).length > 0;
      if (tagIds.size === 0) {
        if (existing && !hasUsages) {
          await this.deleteItem({
            TableName: TABLE_NAME,
            Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
          });
        } else if (existing && hasUsages) {
          await this.putItem({
            TableName: TABLE_NAME,
            Item: marshall(
              {
                LaboratoryId: laboratoryId,
                Sk: skFile(ref),
                S3Bucket: bucket,
                ObjectKey: key,
                TagIds: [],
                LaboratoryRunUsages: existing.LaboratoryRunUsages,
                ModifiedAt: now,
                ModifiedBy: userId,
              },
              { removeUndefinedValues: true },
            ),
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
              ...(hasUsages ? { LaboratoryRunUsages: existing!.LaboratoryRunUsages } : {}),
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
      if (kind === 'batch') {
        batchTagIds.add(t.TagId);
      } else if (kind === 'workflow' || !!(t.Platform && t.WorkflowExternalId)) {
        workflowTagIds.add(t.TagId);
      }
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

  /** Returns true if a new MAP# row was written; false if it already existed. */
  private async putMapRowIfAbsent(
    laboratoryId: string,
    tagId: string,
    ref: string,
    bucket: string,
    key: string,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    try {
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
        ConditionExpression: 'attribute_not_exists(#sk)',
        ExpressionAttributeNames: { '#sk': 'Sk' },
      });
      return true;
    } catch (e: unknown) {
      if (isConditionalCheckFailed(e)) {
        return false;
      }
      throw e;
    }
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
      ConsistentRead: true,
    });
    if (!res.Item) return null;
    return this.tagRowToModel(unmarshall(res.Item) as Record<string, unknown>);
  }

  private async getFileRow(
    laboratoryId: string,
    ref: string,
  ): Promise<{
    TagIds: string[];
    S3Bucket: string;
    ObjectKey: string;
    LaboratoryRunUsages?: Record<string, LaboratoryRunUsageSummary>;
  } | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
      ConsistentRead: true,
    });
    if (!res.Item) return null;
    const row = unmarshall(res.Item) as Record<string, unknown>;
    return {
      TagIds: (row.TagIds as string[]) || [],
      S3Bucket: row.S3Bucket as string,
      ObjectKey: row.ObjectKey as string,
      LaboratoryRunUsages: (row.LaboratoryRunUsages as Record<string, LaboratoryRunUsageSummary>) || undefined,
    };
  }
}
