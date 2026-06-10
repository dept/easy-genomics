import { randomUUID } from 'crypto';
import { QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { _Object } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  BulkCreateSequenceSetsResponse,
  S3TaggedObjectRef,
  UnlinkedBucketObjectsResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  GenerateDataCollectionSampleSheetResponse,
  LaboratoryRunDataCollection,
  LaboratorySequenceSet,
  ListLaboratoryRunDataCollectionsResponse,
  ListLaboratorySequenceSetsResponse,
  SampleSheetColumnDef,
  SequenceSetImportSource,
  SequenceSetLayout,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
import {
  buildSampleSheetFromSequenceSets,
  SequenceSetForSampleSheet,
} from '@easy-genomics/shared-lib/src/app/utils/data-collection-sample-sheet';
import { buildContentsSummary } from '@easy-genomics/shared-lib/src/app/utils/sequence-set-regex-grouping';
import { DataCollectionService } from './data-collection-service';
import { decodeS3ObjectRef, encodeS3ObjectRef, LaboratoryDataTaggingService } from './laboratory-data-tagging-service';
import { DynamoDBService } from '../dynamodb-service';
import { S3Service } from '../s3-service';

const TABLE_NAME = `${process.env.NAME_PREFIX}-laboratory-data-tagging-table`;
const GSI1_NAME = 'Gsi1Pk_Index';

function skSequenceSet(id: string): string {
  return `SEQUENCE_SET#${id}`;
}

function skSeqSetFile(setId: string, ref: string): string {
  return `SEQSETFILE#${setId}#${ref}`;
}

function skDataCollection(id: string): string {
  return `DATA_COLLECTION#${id}`;
}

function skDcSet(collectionId: string, setId: string): string {
  return `DCSET#${collectionId}#${setId}`;
}

function skFile(ref: string): string {
  return `FILE#${ref}`;
}

function gsi1PkForSequenceSet(laboratoryId: string, setId: string): string {
  return `${laboratoryId}#SEQSET#${setId}`;
}

function gsi1PkForDataCollection(laboratoryId: string, collectionId: string): string {
  return `${laboratoryId}#DC#${collectionId}`;
}

export class LaboratorySequenceSetService extends DynamoDBService {
  private taggingService = new LaboratoryDataTaggingService();
  private s3Service = new S3Service();
  private dataCollectionService = new DataCollectionService(this.s3Service);

  public assertKeyUnderLabPrefix(laboratory: Laboratory, key: string): void {
    this.taggingService.assertKeyUnderLabPrefix(laboratory, key);
  }

  public assertBucketMatchesLab(laboratory: Laboratory, bucket: string): void {
    this.taggingService.assertBucketMatchesLab(laboratory, bucket);
  }

  public async listSequenceSets(laboratoryId: string): Promise<ListLaboratorySequenceSetsResponse> {
    const sets: LaboratorySequenceSet[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response: QueryCommandOutput = await this.queryItems({
        TableName: TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'LaboratoryId', '#sk': 'Sk' },
        ExpressionAttributeValues: {
          ':pk': { S: laboratoryId },
          ':prefix': { S: 'SEQUENCE_SET#' },
        },
        ConsistentRead: true,
        ...(startKey ? { ExclusiveStartKey: startKey as never } : {}),
      });
      for (const item of response.Items || []) {
        sets.push(this.sequenceSetRowToModel(unmarshall(item) as Record<string, unknown>));
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    sets.sort((a, b) => a.Name.localeCompare(b.Name));
    return { SequenceSets: sets };
  }

  public async listDataCollections(laboratoryId: string): Promise<ListLaboratoryRunDataCollectionsResponse> {
    const collections: LaboratoryRunDataCollection[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response: QueryCommandOutput = await this.queryItems({
        TableName: TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'LaboratoryId', '#sk': 'Sk' },
        ExpressionAttributeValues: {
          ':pk': { S: laboratoryId },
          ':prefix': { S: 'DATA_COLLECTION#' },
        },
        ConsistentRead: true,
        ...(startKey ? { ExclusiveStartKey: startKey as never } : {}),
      });
      for (const item of response.Items || []) {
        collections.push(this.dataCollectionRowToModel(unmarshall(item) as Record<string, unknown>));
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    collections.sort((a, b) => a.Name.localeCompare(b.Name));
    return { DataCollections: collections };
  }

  public async getSequenceSet(laboratoryId: string, setId: string): Promise<LaboratorySequenceSet | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceSet(setId) }),
      ConsistentRead: true,
    });
    if (!res.Item) return null;
    return this.sequenceSetRowToModel(unmarshall(res.Item) as Record<string, unknown>);
  }

  public async getDataCollection(
    laboratoryId: string,
    collectionId: string,
  ): Promise<LaboratoryRunDataCollection | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skDataCollection(collectionId) }),
      ConsistentRead: true,
    });
    if (!res.Item) return null;
    return this.dataCollectionRowToModel(unmarshall(res.Item) as Record<string, unknown>);
  }

  public async createSequenceSet(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    opts: {
      name: string;
      layout: SequenceSetLayout;
      filenameRegex?: string;
      sampleIdPattern?: string;
      keys: string[];
    },
  ): Promise<LaboratorySequenceSet> {
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);
    for (const key of opts.keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
    }

    const setId = randomUUID();
    const now = new Date().toISOString();
    const set: LaboratorySequenceSet = {
      SequenceSetId: setId,
      Name: opts.name.trim(),
      Layout: opts.layout,
      ...(opts.filenameRegex ? { FilenameRegex: opts.filenameRegex } : {}),
      ...(opts.sampleIdPattern ? { SampleIdPattern: opts.sampleIdPattern } : {}),
      FileCount: 0,
      CreatedAt: now,
      CreatedBy: userId,
      ModifiedAt: now,
      ModifiedBy: userId,
    };

    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          LaboratoryId: laboratoryId,
          Sk: skSequenceSet(setId),
          ...set,
        },
        { removeUndefinedValues: true },
      ),
    });

    const added = await this.addFilesToSequenceSetInternal(laboratory, userId, bucket, setId, opts.keys);
    return { ...set, FileCount: added };
  }

  public async addFilesToSequenceSet(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    setId: string,
    keys: string[],
  ): Promise<void> {
    const existing = await this.getSequenceSet(laboratory.LaboratoryId, setId);
    if (!existing) throw new Error(`Unknown sequence set: ${setId}`);
    await this.addFilesToSequenceSetInternal(laboratory, userId, bucket, setId, keys);
  }

  public async removeFilesFromSequenceSet(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    setId: string,
    keys: string[],
  ): Promise<void> {
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.getSequenceSet(laboratoryId, setId);
    if (!existing) throw new Error(`Unknown sequence set: ${setId}`);

    let removed = 0;
    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);
      const mapSk = skSeqSetFile(setId, ref);
      const mapRow = await this.getItem({
        TableName: TABLE_NAME,
        Key: marshall({ LaboratoryId: laboratoryId, Sk: mapSk }),
      });
      if (!mapRow.Item) continue;

      await this.deleteItem({
        TableName: TABLE_NAME,
        Key: marshall({ LaboratoryId: laboratoryId, Sk: mapSk }),
      });
      removed++;

      await this.removeSequenceSetIdFromFileRow(laboratoryId, ref, setId);
    }

    if (removed > 0) {
      await this.adjustSequenceSetFileCount(laboratoryId, setId, -removed, userId);
    }
  }

  public async listSequenceSetFiles(
    laboratoryId: string,
    setId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ Files: S3TaggedObjectRef[]; NextCursor?: string }> {
    const gsiPk = gsi1PkForSequenceSet(laboratoryId, setId);
    const response: QueryCommandOutput = await this.queryItems({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: '#gpk = :gpk',
      ExpressionAttributeNames: { '#gpk': 'Gsi1Pk' },
      ExpressionAttributeValues: { ':gpk': { S: gsiPk } },
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

  public async listDataCollectionSequenceSetIds(laboratoryId: string, collectionId: string): Promise<string[]> {
    const gsiPk = gsi1PkForDataCollection(laboratoryId, collectionId);
    const ids: string[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response: QueryCommandOutput = await this.queryItems({
        TableName: TABLE_NAME,
        IndexName: GSI1_NAME,
        KeyConditionExpression: '#gpk = :gpk',
        ExpressionAttributeNames: { '#gpk': 'Gsi1Pk' },
        ExpressionAttributeValues: { ':gpk': { S: gsiPk } },
        ...(startKey ? { ExclusiveStartKey: startKey as never } : {}),
      });
      for (const item of response.Items || []) {
        const row = unmarshall(item) as Record<string, string>;
        if (row.SequenceSetId) ids.push(row.SequenceSetId);
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
    return ids;
  }

  public async createDataCollection(
    laboratory: Laboratory,
    userId: string,
    opts: {
      name: string;
      columns: SampleSheetColumnDef[];
      sequenceSetIds: string[];
    },
  ): Promise<LaboratoryRunDataCollection> {
    const laboratoryId = laboratory.LaboratoryId;
    for (const setId of opts.sequenceSetIds) {
      const set = await this.getSequenceSet(laboratoryId, setId);
      if (!set) throw new Error(`Unknown sequence set: ${setId}`);
    }

    const collectionId = randomUUID();
    const now = new Date().toISOString();
    const collection: LaboratoryRunDataCollection = {
      DataCollectionId: collectionId,
      Name: opts.name.trim(),
      Columns: opts.columns,
      SequenceSetCount: 0,
      CreatedAt: now,
      CreatedBy: userId,
      ModifiedAt: now,
      ModifiedBy: userId,
    };

    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          LaboratoryId: laboratoryId,
          Sk: skDataCollection(collectionId),
          ...collection,
        },
        { removeUndefinedValues: true },
      ),
    });

    await this.addSequenceSetsToDataCollectionInternal(laboratory, userId, collectionId, opts.sequenceSetIds);
    const updated = await this.getDataCollection(laboratoryId, collectionId);
    return updated!;
  }

  public async addSequenceSetsToDataCollection(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    sequenceSetIds: string[],
  ): Promise<void> {
    const existing = await this.getDataCollection(laboratory.LaboratoryId, collectionId);
    if (!existing) throw new Error(`Unknown data collection: ${collectionId}`);
    await this.addSequenceSetsToDataCollectionInternal(laboratory, userId, collectionId, sequenceSetIds);
  }

  public async updateDataCollectionSchema(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    columns: SampleSheetColumnDef[],
  ): Promise<LaboratoryRunDataCollection> {
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.getDataCollection(laboratoryId, collectionId);
    if (!existing) throw new Error(`Unknown data collection: ${collectionId}`);

    const now = new Date().toISOString();
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skDataCollection(collectionId) }),
      UpdateExpression: 'SET #cols = :cols, ModifiedAt = :ma, ModifiedBy = :mb',
      ExpressionAttributeNames: { '#cols': 'Columns' },
      ExpressionAttributeValues: marshall({
        ':cols': columns,
        ':ma': now,
        ':mb': userId,
      }),
    });

    const updated = await this.getDataCollection(laboratoryId, collectionId);
    return updated!;
  }

  public async updateDataCollection(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    opts: {
      name: string;
      columns: SampleSheetColumnDef[];
      sequenceSetIds: string[];
    },
  ): Promise<LaboratoryRunDataCollection> {
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.getDataCollection(laboratoryId, collectionId);
    if (!existing) throw new Error(`Unknown data collection: ${collectionId}`);

    for (const setId of opts.sequenceSetIds) {
      const set = await this.getSequenceSet(laboratoryId, setId);
      if (!set) throw new Error(`Unknown sequence set: ${setId}`);
    }

    const currentSetIds = await this.listDataCollectionSequenceSetIds(laboratoryId, collectionId);
    const desiredSetIds = new Set(opts.sequenceSetIds);
    const toAdd = opts.sequenceSetIds.filter((id) => !currentSetIds.includes(id));
    const toRemove = currentSetIds.filter((id) => !desiredSetIds.has(id));

    const now = new Date().toISOString();
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skDataCollection(collectionId) }),
      UpdateExpression: 'SET #name = :name, #cols = :cols, ModifiedAt = :ma, ModifiedBy = :mb',
      ExpressionAttributeNames: { '#name': 'Name', '#cols': 'Columns' },
      ExpressionAttributeValues: marshall({
        ':name': opts.name.trim(),
        ':cols': opts.columns,
        ':ma': now,
        ':mb': userId,
      }),
    });

    if (toRemove.length) {
      await this.removeSequenceSetsFromDataCollectionInternal(laboratoryId, collectionId, toRemove, userId);
    }
    if (toAdd.length) {
      await this.addSequenceSetsToDataCollectionInternal(laboratory, userId, collectionId, toAdd);
    }

    const updated = await this.getDataCollection(laboratoryId, collectionId);
    return updated!;
  }

  public async generateDataCollectionSampleSheet(
    laboratory: Laboratory,
    bucket: string,
    collectionId: string,
    opts: {
      platform: 'AWS HealthOmics' | 'Seqera Cloud';
      transactionId: string;
      sampleSheetName: string;
      validateS3FilesExist?: boolean;
    },
  ): Promise<GenerateDataCollectionSampleSheetResponse> {
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);

    const collection = await this.getDataCollection(laboratoryId, collectionId);
    if (!collection) throw new Error(`Unknown data collection: ${collectionId}`);

    const setIds = await this.listDataCollectionSequenceSetIds(laboratoryId, collectionId);
    if (!setIds.length) throw new Error('Data collection has no sequence sets.');

    const sequenceSets: SequenceSetForSampleSheet[] = [];
    for (const setId of setIds) {
      const setMeta = await this.getSequenceSet(laboratoryId, setId);
      if (!setMeta) continue;
      const { Files } = await this.listSequenceSetFiles(laboratoryId, setId, 500);
      sequenceSets.push({
        SequenceSetId: setId,
        Name: setMeta.Name,
        Layout: setMeta.Layout,
        SampleIdPattern: setMeta.SampleIdPattern,
        FileKeys: Files.map((f) => f.Key),
      });
    }

    const built = buildSampleSheetFromSequenceSets(collection.Columns, sequenceSets, bucket);
    if (!built.ok) throw new Error(built.message);

    if (opts.validateS3FilesExist) {
      for (const key of built.inputFileKeys) {
        const exists = await this.s3Service.doesObjectExist({ Bucket: bucket, Key: key });
        if (!exists) throw new Error(`S3 object not found: ${key}`);
      }
    }

    const platformFolder = opts.platform === 'AWS HealthOmics' ? 'aws-healthomics' : 'seqera-platform';
    const s3Key = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/${platformFolder}/${opts.transactionId}/${opts.sampleSheetName}`;
    await this.s3Service.putObject({
      Bucket: bucket,
      Key: s3Key,
      Body: built.csv,
      ContentType: 'text/csv',
    });

    const sampleSheetS3Url = `s3://${bucket}/${s3Key}`;
    const now = new Date().toISOString();
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skDataCollection(collectionId) }),
      UpdateExpression: 'SET LastSampleSheetS3Url = :url, ModifiedAt = :ma',
      ExpressionAttributeValues: marshall({ ':url': sampleSheetS3Url, ':ma': now }),
    });

    return {
      SampleSheetS3Url: sampleSheetS3Url,
      InputFileKeys: built.inputFileKeys,
      CsvPreview: built.csv,
    };
  }

  /** Returns sequence set ids per file ref for listFileTags enrichment. */
  public async getSequenceSetIdsForFileRefs(laboratoryId: string, refs: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    for (const ref of refs) {
      const fileRow = await this.getFileRowSequenceSetIds(laboratoryId, ref);
      result.set(ref, fileRow);
    }
    return result;
  }

  public async listUnlinkedBucketObjects(
    laboratory: Laboratory,
    opts: {
      relativePrefix?: string;
      maxTotalKeys?: number;
      maxTransactionFolders?: number;
      pageSize?: number;
    },
  ): Promise<UnlinkedBucketObjectsResponse> {
    const s3Bucket = laboratory.S3Bucket || '';
    if (!s3Bucket) throw new Error('Laboratory has no S3 bucket configured');

    const labRoot = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const relative = (opts.relativePrefix || '').replace(/^\/*/, '');
    let normalizedPrefix = `${labRoot}${relative}`;
    if (!normalizedPrefix.endsWith('/')) normalizedPrefix = `${normalizedPrefix}/`;
    if (!normalizedPrefix.startsWith(labRoot)) throw new Error('Prefix is outside laboratory scope');

    const pageSize = Math.min(opts.pageSize ?? 1000, 1000);
    const maxTotalKeys = Math.min(opts.maxTotalKeys ?? 15_000, 50_000);
    const maxTransactionFolders = Math.min(opts.maxTransactionFolders ?? 10_000, 50_000);

    const { contents: allContents, listingTruncated } = await this.dataCollectionService.listTransactionInputs({
      bucket: s3Bucket,
      labPrefix: normalizedPrefix,
      pageSize,
      maxTotalKeys,
      maxTransactionFolders,
    });

    const unlinked: _Object[] = [];
    const CHUNK = 100;
    for (let i = 0; i < allContents.length; i += CHUNK) {
      const chunk = allContents.slice(i, i + CHUNK);
      const refs = chunk.map((o) => encodeS3ObjectRef(s3Bucket, o.Key!));
      const setIdsByRef = await this.getSequenceSetIdsForFileRefs(laboratory.LaboratoryId, refs);
      for (const obj of chunk) {
        if (!obj.Key) continue;
        const ref = encodeS3ObjectRef(s3Bucket, obj.Key);
        const setIds = setIdsByRef.get(ref) || [];
        if (!setIds.length) unlinked.push(obj);
      }
    }

    return {
      Contents: unlinked.map((o) => ({
        Key: o.Key!,
        ...(o.LastModified ? { LastModified: o.LastModified.toISOString() } : {}),
        ...(o.Size != null ? { Size: o.Size } : {}),
      })),
      IsTruncated: listingTruncated,
      S3Bucket: s3Bucket,
      ResolvedPrefix: normalizedPrefix,
      ListingTruncated: listingTruncated,
      ReturnedKeyCount: unlinked.length,
    };
  }

  public async bulkCreateSequenceSets(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    opts: {
      importLabel: string;
      sequenceSets: Array<{
        name: string;
        layout: SequenceSetLayout;
        keys: string[];
        tagIds?: string[];
        filenameRegex?: string;
        sampleIdPattern?: string;
      }>;
      copyJobs?: Array<{ sourceBucket: string; sourceKey: string; destKey: string }>;
    },
  ): Promise<BulkCreateSequenceSetsResponse> {
    this.assertBucketMatchesLab(laboratory, bucket);
    const importSource: SequenceSetImportSource = {
      type: 's3_import',
      label: opts.importLabel,
      importedAt: new Date().toISOString(),
    };

    for (const job of opts.copyJobs || []) {
      this.assertKeyUnderLabPrefix(laboratory, job.destKey);
      await this.s3Service.copyBucketObject({
        Bucket: bucket,
        Key: job.destKey,
        CopySource: `${job.sourceBucket}/${job.sourceKey}`,
      });
    }

    const BULK_CREATE_CONCURRENCY = 5;
    const createdIds: string[] = [];
    const errors: Array<{ Name: string; Message: string }> = [];

    for (let i = 0; i < opts.sequenceSets.length; i += BULK_CREATE_CONCURRENCY) {
      const chunk = opts.sequenceSets.slice(i, i + BULK_CREATE_CONCURRENCY);
      const outcomes = await Promise.all(
        chunk.map(async (item) => {
          try {
            const set = await this.createSequenceSetWithImport(laboratory, userId, bucket, {
              ...item,
              importSource,
            });
            if (item.tagIds?.length) {
              await this.taggingService.applyTagsToSequenceSets(
                laboratory,
                userId,
                [set.SequenceSetId],
                item.tagIds,
                [],
              );
            }
            return { ok: true as const, id: set.SequenceSetId };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return { ok: false as const, name: item.name, message };
          }
        }),
      );

      for (const outcome of outcomes) {
        if (outcome.ok) createdIds.push(outcome.id);
        else errors.push({ Name: outcome.name, Message: outcome.message });
      }
    }

    return {
      CreatedCount: createdIds.length,
      SequenceSetIds: createdIds,
      ...(errors.length ? { Errors: errors } : {}),
    };
  }

  private async createSequenceSetWithImport(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    opts: {
      name: string;
      layout: SequenceSetLayout;
      keys: string[];
      filenameRegex?: string;
      sampleIdPattern?: string;
      importSource: SequenceSetImportSource;
    },
  ): Promise<LaboratorySequenceSet> {
    const laboratoryId = laboratory.LaboratoryId;
    for (const key of opts.keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
    }

    const setId = randomUUID();
    const now = new Date().toISOString();
    const fileRoles = opts.keys.map((k) => {
      const base = k.split('/').pop() || k;
      let role: 'read1' | 'read2' | 'reads' | 'reference_fasta' | 'extra' = 'extra';
      if (/R1/i.test(base)) role = 'read1';
      else if (/R2/i.test(base)) role = 'read2';
      else if (/\.fastq|\.fq/i.test(base)) role = 'reads';
      else if (/\.fasta|\.fa/i.test(base)) role = 'reference_fasta';
      return { fileName: base, role };
    });
    const contentsSummary = buildContentsSummary(fileRoles);

    const set: LaboratorySequenceSet = {
      SequenceSetId: setId,
      Name: opts.name.trim(),
      Layout: opts.layout,
      ...(opts.filenameRegex ? { FilenameRegex: opts.filenameRegex } : {}),
      ...(opts.sampleIdPattern ? { SampleIdPattern: opts.sampleIdPattern } : {}),
      FileCount: 0,
      ImportSource: opts.importSource,
      ContentsSummary: contentsSummary,
      TagIds: [],
      CreatedAt: now,
      CreatedBy: userId,
      ModifiedAt: now,
      ModifiedBy: userId,
    };

    await this.putItem({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          LaboratoryId: laboratoryId,
          Sk: skSequenceSet(setId),
          ...set,
        },
        { removeUndefinedValues: true },
      ),
    });

    const added = await this.addFilesToSequenceSetInternal(laboratory, userId, bucket, setId, opts.keys);
    return { ...set, FileCount: added };
  }

  private async addFilesToSequenceSetInternal(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    setId: string,
    keys: string[],
  ): Promise<number> {
    const laboratoryId = laboratory.LaboratoryId;
    let added = 0;

    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);
      const mapSk = skSeqSetFile(setId, ref);

      try {
        await this.putItem({
          TableName: TABLE_NAME,
          Item: marshall(
            {
              LaboratoryId: laboratoryId,
              Sk: mapSk,
              Gsi1Pk: gsi1PkForSequenceSet(laboratoryId, setId),
              Gsi1Sk: ref,
              SequenceSetId: setId,
              S3Bucket: bucket,
              ObjectKey: key,
              CreatedAt: new Date().toISOString(),
            },
            { removeUndefinedValues: true },
          ),
          ConditionExpression: 'attribute_not_exists(#sk)',
          ExpressionAttributeNames: { '#sk': 'Sk' },
        });
        added++;
        await this.addSequenceSetIdToFileRow(laboratoryId, ref, bucket, key, setId, userId);
      } catch (e: unknown) {
        const name = typeof e === 'object' && e !== null ? (e as { name?: string }).name : undefined;
        if (name !== 'ConditionalCheckFailedException') throw e;
      }
    }

    if (added > 0) {
      await this.adjustSequenceSetFileCount(laboratoryId, setId, added, userId);
    }
    return added;
  }

  private async addSequenceSetsToDataCollectionInternal(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    sequenceSetIds: string[],
  ): Promise<void> {
    const laboratoryId = laboratory.LaboratoryId;
    let added = 0;

    for (const setId of sequenceSetIds) {
      const set = await this.getSequenceSet(laboratoryId, setId);
      if (!set) throw new Error(`Unknown sequence set: ${setId}`);

      const mapSk = skDcSet(collectionId, setId);
      try {
        await this.putItem({
          TableName: TABLE_NAME,
          Item: marshall(
            {
              LaboratoryId: laboratoryId,
              Sk: mapSk,
              Gsi1Pk: gsi1PkForDataCollection(laboratoryId, collectionId),
              Gsi1Sk: setId,
              DataCollectionId: collectionId,
              SequenceSetId: setId,
              CreatedAt: new Date().toISOString(),
            },
            { removeUndefinedValues: true },
          ),
          ConditionExpression: 'attribute_not_exists(#sk)',
          ExpressionAttributeNames: { '#sk': 'Sk' },
        });
        added++;
      } catch (e: unknown) {
        const name = typeof e === 'object' && e !== null ? (e as { name?: string }).name : undefined;
        if (name !== 'ConditionalCheckFailedException') throw e;
      }
    }

    if (added > 0) {
      await this.adjustDataCollectionSetCount(laboratoryId, collectionId, added, userId);
    }
  }

  private async removeSequenceSetsFromDataCollectionInternal(
    laboratoryId: string,
    collectionId: string,
    sequenceSetIds: string[],
    userId: string,
  ): Promise<void> {
    let removed = 0;

    for (const setId of sequenceSetIds) {
      try {
        await this.deleteItem({
          TableName: TABLE_NAME,
          Key: marshall({ LaboratoryId: laboratoryId, Sk: skDcSet(collectionId, setId) }),
          ConditionExpression: 'attribute_exists(#sk)',
          ExpressionAttributeNames: { '#sk': 'Sk' },
        });
        removed++;
      } catch (e: unknown) {
        const name = typeof e === 'object' && e !== null ? (e as { name?: string }).name : undefined;
        if (name !== 'ConditionalCheckFailedException') throw e;
      }
    }

    if (removed > 0) {
      await this.adjustDataCollectionSetCount(laboratoryId, collectionId, -removed, userId);
    }
  }

  private async addSequenceSetIdToFileRow(
    laboratoryId: string,
    ref: string,
    bucket: string,
    key: string,
    setId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.updateItem({
        TableName: TABLE_NAME,
        Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
        UpdateExpression:
          'SET SequenceSetIds = list_append(if_not_exists(SequenceSetIds, :empty), :sid), S3Bucket = :b, ObjectKey = :k, ModifiedAt = :ma',
        ConditionExpression: 'attribute_not_exists(SequenceSetIds) OR NOT contains(SequenceSetIds, :oneId)',
        ExpressionAttributeValues: marshall({
          ':sid': [setId],
          ':oneId': setId,
          ':empty': [],
          ':b': bucket,
          ':k': key,
          ':ma': now,
        }),
      });
    } catch (e: unknown) {
      const name = typeof e === 'object' && e !== null ? (e as { name?: string }).name : undefined;
      if (name === 'ConditionalCheckFailedException') return;
      // File row may not exist yet — create it
      await this.putItem({
        TableName: TABLE_NAME,
        Item: marshall(
          {
            LaboratoryId: laboratoryId,
            Sk: skFile(ref),
            S3Bucket: bucket,
            ObjectKey: key,
            TagIds: [],
            SequenceSetIds: [setId],
            ModifiedAt: now,
            CreatedAt: now,
            CreatedBy: userId,
          },
          { removeUndefinedValues: true },
        ),
      });
    }
  }

  private async removeSequenceSetIdFromFileRow(laboratoryId: string, ref: string, setId: string): Promise<void> {
    const row = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
    });
    if (!row.Item) return;
    const data = unmarshall(row.Item) as Record<string, unknown>;
    const ids = ((data.SequenceSetIds as string[]) || []).filter((id) => id !== setId);
    const tagIds = (data.TagIds as string[]) || [];
    const hasUsages = data.LaboratoryRunUsages && Object.keys(data.LaboratoryRunUsages as object).length > 0;

    if (ids.length === 0 && tagIds.length === 0 && !hasUsages) {
      await this.deleteItem({
        TableName: TABLE_NAME,
        Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
      });
    } else {
      await this.updateItem({
        TableName: TABLE_NAME,
        Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
        UpdateExpression: 'SET SequenceSetIds = :ids, ModifiedAt = :ma',
        ExpressionAttributeValues: marshall({
          ':ids': ids,
          ':ma': new Date().toISOString(),
        }),
      });
    }
  }

  private async getFileRowSequenceSetIds(laboratoryId: string, ref: string): Promise<string[]> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
      ConsistentRead: true,
    });
    if (!res.Item) return [];
    const data = unmarshall(res.Item) as Record<string, unknown>;
    return (data.SequenceSetIds as string[]) || [];
  }

  private async adjustSequenceSetFileCount(
    laboratoryId: string,
    setId: string,
    delta: number,
    userId: string,
  ): Promise<void> {
    if (delta === 0) return;
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceSet(setId) }),
      UpdateExpression: 'ADD FileCount :delta SET ModifiedAt = :ma, ModifiedBy = :mb',
      ExpressionAttributeValues: marshall({
        ':delta': delta,
        ':ma': new Date().toISOString(),
        ':mb': userId,
      }),
    });
  }

  private async adjustDataCollectionSetCount(
    laboratoryId: string,
    collectionId: string,
    delta: number,
    userId: string,
  ): Promise<void> {
    const row = await this.getDataCollection(laboratoryId, collectionId);
    if (!row) return;
    const next = Math.max(0, (row.SequenceSetCount || 0) + delta);
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skDataCollection(collectionId) }),
      UpdateExpression: 'SET SequenceSetCount = :n, ModifiedAt = :ma, ModifiedBy = :mb',
      ExpressionAttributeValues: marshall({
        ':n': next,
        ':ma': new Date().toISOString(),
        ':mb': userId,
      }),
    });
  }

  private sequenceSetRowToModel(row: Record<string, unknown>): LaboratorySequenceSet {
    const allTagIds = (row.TagIds as string[]) || [];
    return {
      SequenceSetId: row.SequenceSetId as string,
      Name: row.Name as string,
      Layout: row.Layout as SequenceSetLayout,
      ...(row.FilenameRegex ? { FilenameRegex: row.FilenameRegex as string } : {}),
      ...(row.SampleIdPattern ? { SampleIdPattern: row.SampleIdPattern as string } : {}),
      FileCount: (row.FileCount as number) || 0,
      ...(allTagIds.length ? { TagIds: allTagIds } : {}),
      ...(row.ImportSource ? { ImportSource: row.ImportSource as SequenceSetImportSource } : {}),
      ...(row.ContentsSummary ? { ContentsSummary: row.ContentsSummary as string } : {}),
      CreatedAt: row.CreatedAt as string | undefined,
      CreatedBy: row.CreatedBy as string | undefined,
      ModifiedAt: row.ModifiedAt as string | undefined,
      ModifiedBy: row.ModifiedBy as string | undefined,
    };
  }

  private dataCollectionRowToModel(row: Record<string, unknown>): LaboratoryRunDataCollection {
    return {
      DataCollectionId: row.DataCollectionId as string,
      Name: row.Name as string,
      Columns: (row.Columns as SampleSheetColumnDef[]) || [],
      SequenceSetCount: (row.SequenceSetCount as number) || 0,
      ...(row.LastSampleSheetS3Url ? { LastSampleSheetS3Url: row.LastSampleSheetS3Url as string } : {}),
      CreatedAt: row.CreatedAt as string | undefined,
      CreatedBy: row.CreatedBy as string | undefined,
      ModifiedAt: row.ModifiedAt as string | undefined,
      ModifiedBy: row.ModifiedBy as string | undefined,
    };
  }
}

export { decodeS3ObjectRef, encodeS3ObjectRef };
