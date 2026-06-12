import { randomUUID } from 'crypto';
import { QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { _Object } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  BulkCreateSamplesResponse,
  S3TaggedObjectRef,
  UnlinkedBucketObjectsResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  GenerateSequenceCollectionSampleSheetResponse,
  LaboratorySequenceCollection,
  LaboratorySample,
  ListLaboratorySequenceCollectionsResponse,
  ListLaboratorySamplesResponse,
  SampleSheetColumnDef,
  SampleImportSource,
  SampleLayout,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
import {
  buildSampleSheetFromSamples,
  SampleForSampleSheet,
} from '@easy-genomics/shared-lib/src/app/utils/data-collection-sample-sheet';
import { isFilenameRegexSafe } from '@easy-genomics/shared-lib/src/app/utils/filename-regex-safety';
import {
  InvalidRequestError,
  SampleNotFoundError,
  SequenceCollectionNotFoundError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { buildContentsSummary } from '@easy-genomics/shared-lib/src/app/utils/sample-regex-grouping';
import { DataCollectionService } from './data-collection-service';
import {
  decodeS3ObjectRef,
  encodeS3ObjectRef,
  isConditionalCheckFailed,
  LaboratoryDataTaggingService,
  permanentTagIdForLaboratory,
  skSample,
} from './laboratory-data-tagging-service';
import { DynamoDBService } from '../dynamodb-service';
import { S3Service } from '../s3-service';

const TABLE_NAME = `${process.env.NAME_PREFIX}-laboratory-data-tagging-table`;
const GSI1_NAME = 'Gsi1Pk_Index';

function skSampleFile(setId: string, ref: string): string {
  return `SAMPLEFILE#${setId}#${ref}`;
}

function skSequenceCollection(id: string): string {
  return `SEQUENCE_COLLECTION#${id}`;
}

function skDcSet(collectionId: string, setId: string): string {
  return `SCSET#${collectionId}#${setId}`;
}

function skFile(ref: string): string {
  return `FILE#${ref}`;
}

function gsi1PkForSample(laboratoryId: string, setId: string): string {
  return `${laboratoryId}#SAMPLE#${setId}`;
}

function gsi1PkForSequenceCollection(laboratoryId: string, collectionId: string): string {
  return `${laboratoryId}#SC#${collectionId}`;
}

export class LaboratorySampleService extends DynamoDBService {
  private taggingService = new LaboratoryDataTaggingService();
  private s3Service = new S3Service();
  private dataCollectionService = new DataCollectionService(this.s3Service);

  public assertKeyUnderLabPrefix(laboratory: Laboratory, key: string): void {
    this.taggingService.assertKeyUnderLabPrefix(laboratory, key);
  }

  public assertBucketMatchesLab(laboratory: Laboratory, bucket: string): void {
    this.taggingService.assertBucketMatchesLab(laboratory, bucket);
  }

  public async listSamples(laboratoryId: string): Promise<ListLaboratorySamplesResponse> {
    const { batchTagIds, workflowTagIds, permanentTagIds } =
      await this.taggingService.getKindIndexedTagIds(laboratoryId);
    const sets: LaboratorySample[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response: QueryCommandOutput = await this.queryItems({
        TableName: TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'LaboratoryId', '#sk': 'Sk' },
        ExpressionAttributeValues: {
          ':pk': { S: laboratoryId },
          ':prefix': { S: 'SAMPLE#' },
        },
        ConsistentRead: true,
        ...(startKey ? { ExclusiveStartKey: startKey as never } : {}),
      });
      for (const item of response.Items || []) {
        sets.push(
          this.sampleRowToModel(unmarshall(item) as Record<string, unknown>, {
            batchTagIds,
            workflowTagIds,
            permanentTagIds,
          }),
        );
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    sets.sort((a, b) => a.Name.localeCompare(b.Name));
    return { Samples: sets };
  }

  public async listSequenceCollections(laboratoryId: string): Promise<ListLaboratorySequenceCollectionsResponse> {
    const collections: LaboratorySequenceCollection[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response: QueryCommandOutput = await this.queryItems({
        TableName: TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': 'LaboratoryId', '#sk': 'Sk' },
        ExpressionAttributeValues: {
          ':pk': { S: laboratoryId },
          ':prefix': { S: 'SEQUENCE_COLLECTION#' },
        },
        ConsistentRead: true,
        ...(startKey ? { ExclusiveStartKey: startKey as never } : {}),
      });
      for (const item of response.Items || []) {
        collections.push(this.sequenceCollectionRowToModel(unmarshall(item) as Record<string, unknown>));
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    collections.sort((a, b) => a.Name.localeCompare(b.Name));
    return { SequenceCollections: collections };
  }

  public async getSample(laboratoryId: string, setId: string): Promise<LaboratorySample | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSample(setId) }),
      ConsistentRead: true,
    });
    if (!res.Item) return null;
    const { batchTagIds, workflowTagIds, permanentTagIds } =
      await this.taggingService.getKindIndexedTagIds(laboratoryId);
    return this.sampleRowToModel(unmarshall(res.Item) as Record<string, unknown>, {
      batchTagIds,
      workflowTagIds,
      permanentTagIds,
    });
  }

  public async getSequenceCollection(
    laboratoryId: string,
    collectionId: string,
  ): Promise<LaboratorySequenceCollection | null> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceCollection(collectionId) }),
      ConsistentRead: true,
    });
    if (!res.Item) return null;
    return this.sequenceCollectionRowToModel(unmarshall(res.Item) as Record<string, unknown>);
  }

  public async createSample(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    opts: {
      name: string;
      layout: SampleLayout;
      filenameRegex?: string;
      sampleIdPattern?: string;
      keys: string[];
    },
  ): Promise<LaboratorySample> {
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);
    for (const key of opts.keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
    }

    const setId = randomUUID();
    const now = new Date().toISOString();
    const set: LaboratorySample = {
      SampleId: setId,
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
          Sk: skSample(setId),
          ...set,
        },
        { removeUndefinedValues: true },
      ),
    });

    const added = await this.addFilesToSampleInternal(laboratory, userId, bucket, setId, opts.keys);
    return { ...set, FileCount: added };
  }

  public async addFilesToSample(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    setId: string,
    keys: string[],
  ): Promise<void> {
    const existing = await this.getSample(laboratory.LaboratoryId, setId);
    if (!existing) throw new SampleNotFoundError(setId);
    await this.addFilesToSampleInternal(laboratory, userId, bucket, setId, keys);
  }

  public async createOrExtendSample(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    opts: {
      keys: string[];
      layout: SampleLayout;
      existingSampleId?: string;
      name?: string;
      filenameRegex?: string;
      sampleIdPattern?: string;
      expandRegexFromListing?: boolean;
    },
  ): Promise<LaboratorySample> {
    this.assertBucketMatchesLab(laboratory, bucket);
    let keys = [...opts.keys];

    if (opts.expandRegexFromListing && opts.filenameRegex) {
      if (!isFilenameRegexSafe(opts.filenameRegex)) {
        throw new InvalidRequestError('Filename regex is not allowed');
      }
      const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
      const { contents } = await this.dataCollectionService.listTransactionInputs({
        bucket,
        labPrefix,
        pageSize: 1000,
      });
      const regex = new RegExp(opts.filenameRegex);
      for (const obj of contents) {
        if (!obj.Key) continue;
        const base = obj.Key.split('/').pop() || obj.Key;
        if (regex.test(base)) keys.push(obj.Key);
      }
      keys = [...new Set(keys)];
    }

    if (opts.existingSampleId) {
      if (!keys.length) throw new InvalidRequestError('At least one file key is required');
      await this.addFilesToSample(laboratory, userId, bucket, opts.existingSampleId, keys);
      const set = await this.getSample(laboratory.LaboratoryId, opts.existingSampleId);
      if (!set) throw new SampleNotFoundError(opts.existingSampleId);
      return set;
    }

    if (!opts.name || !keys.length) throw new InvalidRequestError();

    return this.createSample(laboratory, userId, bucket, {
      name: opts.name,
      layout: opts.layout,
      filenameRegex: opts.filenameRegex,
      sampleIdPattern: opts.sampleIdPattern,
      keys,
    });
  }

  public async removeFilesFromSample(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    setId: string,
    keys: string[],
  ): Promise<void> {
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.getSample(laboratoryId, setId);
    if (!existing) throw new SampleNotFoundError(setId);

    let removed = 0;
    for (const key of keys) {
      this.assertKeyUnderLabPrefix(laboratory, key);
      const ref = encodeS3ObjectRef(bucket, key);
      const mapSk = skSampleFile(setId, ref);
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

      await this.removeSampleIdFromFileRow(laboratoryId, ref, setId);
    }

    if (removed > 0) {
      await this.adjustSampleFileCount(laboratoryId, setId, -removed, userId);
    }
  }

  public async listSampleFiles(
    laboratoryId: string,
    setId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ Files: S3TaggedObjectRef[]; NextCursor?: string }> {
    const gsiPk = gsi1PkForSample(laboratoryId, setId);
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

  private async listAllSampleFiles(laboratoryId: string, setId: string): Promise<S3TaggedObjectRef[]> {
    const all: S3TaggedObjectRef[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listSampleFiles(laboratoryId, setId, 500, cursor);
      all.push(...page.Files);
      cursor = page.NextCursor;
    } while (cursor);
    return all;
  }

  public async listSequenceCollectionSampleIds(laboratoryId: string, collectionId: string): Promise<string[]> {
    const gsiPk = gsi1PkForSequenceCollection(laboratoryId, collectionId);
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
        if (row.SampleId) ids.push(row.SampleId);
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
    return ids;
  }

  public async createSequenceCollection(
    laboratory: Laboratory,
    userId: string,
    opts: {
      name: string;
      columns: SampleSheetColumnDef[];
      sampleIds: string[];
    },
  ): Promise<LaboratorySequenceCollection> {
    const laboratoryId = laboratory.LaboratoryId;
    for (const setId of opts.sampleIds) {
      const set = await this.getSample(laboratoryId, setId);
      if (!set) throw new SampleNotFoundError(setId);
    }

    const collectionId = randomUUID();
    const now = new Date().toISOString();
    const collection: LaboratorySequenceCollection = {
      SequenceCollectionId: collectionId,
      Name: opts.name.trim(),
      Columns: opts.columns,
      SampleCount: 0,
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
          Sk: skSequenceCollection(collectionId),
          ...collection,
        },
        { removeUndefinedValues: true },
      ),
    });

    await this.addSamplesToSequenceCollectionInternal(laboratory, userId, collectionId, opts.sampleIds);
    const updated = await this.getSequenceCollection(laboratoryId, collectionId);
    return updated!;
  }

  public async addSamplesToSequenceCollection(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    sampleIds: string[],
  ): Promise<void> {
    const existing = await this.getSequenceCollection(laboratory.LaboratoryId, collectionId);
    if (!existing) throw new SequenceCollectionNotFoundError(collectionId);
    await this.addSamplesToSequenceCollectionInternal(laboratory, userId, collectionId, sampleIds);
  }

  public async updateSequenceCollectionSchema(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    columns: SampleSheetColumnDef[],
  ): Promise<LaboratorySequenceCollection> {
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.getSequenceCollection(laboratoryId, collectionId);
    if (!existing) throw new SequenceCollectionNotFoundError(collectionId);

    const now = new Date().toISOString();
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceCollection(collectionId) }),
      UpdateExpression: 'SET #cols = :cols, ModifiedAt = :ma, ModifiedBy = :mb',
      ExpressionAttributeNames: { '#cols': 'Columns' },
      ExpressionAttributeValues: marshall({
        ':cols': columns,
        ':ma': now,
        ':mb': userId,
      }),
    });

    const updated = await this.getSequenceCollection(laboratoryId, collectionId);
    return updated!;
  }

  public async deleteSequenceCollection(laboratoryId: string, collectionId: string): Promise<void> {
    const existing = await this.getSequenceCollection(laboratoryId, collectionId);
    if (!existing) throw new SequenceCollectionNotFoundError(collectionId);

    const gsiPk = gsi1PkForSequenceCollection(laboratoryId, collectionId);
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
        await this.deleteItem({
          TableName: TABLE_NAME,
          Key: marshall({ LaboratoryId: laboratoryId, Sk: row.Sk }),
        });
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    await this.deleteItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceCollection(collectionId) }),
    });
  }

  public async updateSequenceCollection(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    opts: {
      name: string;
      columns: SampleSheetColumnDef[];
      sampleIds: string[];
    },
  ): Promise<LaboratorySequenceCollection> {
    const laboratoryId = laboratory.LaboratoryId;
    const existing = await this.getSequenceCollection(laboratoryId, collectionId);
    if (!existing) throw new SequenceCollectionNotFoundError(collectionId);

    for (const setId of opts.sampleIds) {
      const set = await this.getSample(laboratoryId, setId);
      if (!set) throw new SampleNotFoundError(setId);
    }

    const currentSetIds = await this.listSequenceCollectionSampleIds(laboratoryId, collectionId);
    const desiredSetIds = new Set(opts.sampleIds);
    const toAdd = opts.sampleIds.filter((id) => !currentSetIds.includes(id));
    const toRemove = currentSetIds.filter((id) => !desiredSetIds.has(id));

    const now = new Date().toISOString();
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceCollection(collectionId) }),
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
      await this.removeSamplesFromSequenceCollectionInternal(laboratoryId, collectionId, toRemove, userId);
    }
    if (toAdd.length) {
      await this.addSamplesToSequenceCollectionInternal(laboratory, userId, collectionId, toAdd);
    }

    const updated = await this.getSequenceCollection(laboratoryId, collectionId);
    return updated!;
  }

  public async generateSequenceCollectionSampleSheet(
    laboratory: Laboratory,
    bucket: string,
    collectionId: string,
    opts: {
      platform: 'AWS HealthOmics' | 'Seqera Cloud';
      transactionId: string;
      sampleSheetName: string;
      validateS3FilesExist?: boolean;
    },
  ): Promise<GenerateSequenceCollectionSampleSheetResponse> {
    const laboratoryId = laboratory.LaboratoryId;
    this.assertBucketMatchesLab(laboratory, bucket);

    const collection = await this.getSequenceCollection(laboratoryId, collectionId);
    if (!collection) throw new SequenceCollectionNotFoundError(collectionId);

    const setIds = await this.listSequenceCollectionSampleIds(laboratoryId, collectionId);
    if (!setIds.length) throw new InvalidRequestError('Sequence collection has no samples.');

    const samples: SampleForSampleSheet[] = [];
    for (const setId of setIds) {
      const setMeta = await this.getSample(laboratoryId, setId);
      if (!setMeta) continue;
      const files = await this.listAllSampleFiles(laboratoryId, setId);
      samples.push({
        SampleId: setId,
        Name: setMeta.Name,
        Layout: setMeta.Layout,
        SampleIdPattern: setMeta.SampleIdPattern,
        FileKeys: files.map((f) => f.Key),
      });
    }

    const built = buildSampleSheetFromSamples(collection.Columns, samples, bucket);
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
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceCollection(collectionId) }),
      UpdateExpression: 'SET LastSampleSheetS3Url = :url, ModifiedAt = :ma',
      ExpressionAttributeValues: marshall({ ':url': sampleSheetS3Url, ':ma': now }),
    });

    return {
      SampleSheetS3Url: sampleSheetS3Url,
      InputFileKeys: built.inputFileKeys,
      CsvPreview: built.csv,
    };
  }

  /** Returns sample ids per file ref for listFileTags enrichment. */
  public async getSampleIdsForFileRefs(laboratoryId: string, refs: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    for (const ref of refs) {
      const fileRow = await this.getFileRowSampleIds(laboratoryId, ref);
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
      const setIdsByRef = await this.getSampleIdsForFileRefs(laboratory.LaboratoryId, refs);
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

  public async bulkCreateSamples(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    opts: {
      importLabel: string;
      samples: Array<{
        name: string;
        layout: SampleLayout;
        keys: string[];
        tagIds?: string[];
        filenameRegex?: string;
        sampleIdPattern?: string;
      }>;
      copyJobs?: Array<{ sourceBucket: string; sourceKey: string; destKey: string }>;
      newBatchName?: string;
      batchTagId?: string;
    },
  ): Promise<BulkCreateSamplesResponse> {
    this.assertBucketMatchesLab(laboratory, bucket);
    const importSource: SampleImportSource = {
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

    for (let i = 0; i < opts.samples.length; i += BULK_CREATE_CONCURRENCY) {
      const chunk = opts.samples.slice(i, i + BULK_CREATE_CONCURRENCY);
      const outcomes = await Promise.all(
        chunk.map(async (item) => {
          try {
            const set = await this.createSampleWithImport(laboratory, userId, bucket, {
              ...item,
              importSource,
            });
            if (item.tagIds?.length) {
              await this.taggingService.applyTagsToSamples(laboratory, userId, [set.SampleId], item.tagIds, []);
            }
            return { ok: true as const, id: set.SampleId };
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

    if (createdIds.length) {
      if (opts.newBatchName) {
        await this.taggingService.setBatchForSamples(laboratory, userId, createdIds, {
          type: 'new',
          name: opts.newBatchName,
        });
      } else if (opts.batchTagId) {
        await this.taggingService.setBatchForSamples(laboratory, userId, createdIds, {
          type: 'existing',
          batchTagId: opts.batchTagId,
        });
      }
    }

    return {
      CreatedCount: createdIds.length,
      SampleIds: createdIds,
      ...(errors.length ? { Errors: errors } : {}),
    };
  }

  private async createSampleWithImport(
    laboratory: Laboratory,
    userId: string,
    bucket: string,
    opts: {
      name: string;
      layout: SampleLayout;
      keys: string[];
      filenameRegex?: string;
      sampleIdPattern?: string;
      importSource: SampleImportSource;
    },
  ): Promise<LaboratorySample> {
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

    const set: LaboratorySample = {
      SampleId: setId,
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
          Sk: skSample(setId),
          ...set,
        },
        { removeUndefinedValues: true },
      ),
    });

    const added = await this.addFilesToSampleInternal(laboratory, userId, bucket, setId, opts.keys);
    return { ...set, FileCount: added };
  }

  private async addFilesToSampleInternal(
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
      const mapSk = skSampleFile(setId, ref);

      try {
        await this.putItem({
          TableName: TABLE_NAME,
          Item: marshall(
            {
              LaboratoryId: laboratoryId,
              Sk: mapSk,
              Gsi1Pk: gsi1PkForSample(laboratoryId, setId),
              Gsi1Sk: ref,
              SampleId: setId,
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
        await this.addSampleIdToFileRow(laboratoryId, ref, bucket, key, setId, userId);
      } catch (e: unknown) {
        const name = typeof e === 'object' && e !== null ? (e as { name?: string }).name : undefined;
        if (name !== 'ConditionalCheckFailedException') throw e;
      }
    }

    if (added > 0) {
      await this.adjustSampleFileCount(laboratoryId, setId, added, userId);
    }
    return added;
  }

  private async addSamplesToSequenceCollectionInternal(
    laboratory: Laboratory,
    userId: string,
    collectionId: string,
    sampleIds: string[],
  ): Promise<void> {
    const laboratoryId = laboratory.LaboratoryId;
    let added = 0;

    for (const setId of sampleIds) {
      const set = await this.getSample(laboratoryId, setId);
      if (!set) throw new SampleNotFoundError(setId);

      const mapSk = skDcSet(collectionId, setId);
      try {
        await this.putItem({
          TableName: TABLE_NAME,
          Item: marshall(
            {
              LaboratoryId: laboratoryId,
              Sk: mapSk,
              Gsi1Pk: gsi1PkForSequenceCollection(laboratoryId, collectionId),
              Gsi1Sk: setId,
              SequenceCollectionId: collectionId,
              SampleId: setId,
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
      await this.adjustSequenceCollectionSampleCount(laboratoryId, collectionId, added, userId);
    }
  }

  private async removeSamplesFromSequenceCollectionInternal(
    laboratoryId: string,
    collectionId: string,
    sampleIds: string[],
    userId: string,
  ): Promise<void> {
    let removed = 0;

    for (const setId of sampleIds) {
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
      await this.adjustSequenceCollectionSampleCount(laboratoryId, collectionId, -removed, userId);
    }
  }

  private async addSampleIdToFileRow(
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
          'SET SampleIds = list_append(if_not_exists(SampleIds, :empty), :sid), S3Bucket = :b, ObjectKey = :k, ModifiedAt = :ma',
        ConditionExpression: 'attribute_not_exists(SampleIds) OR NOT contains(SampleIds, :oneId)',
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
            SampleIds: [setId],
            ModifiedAt: now,
            CreatedAt: now,
            CreatedBy: userId,
          },
          { removeUndefinedValues: true },
        ),
      });
    }
  }

  private async removeSampleIdFromFileRow(laboratoryId: string, ref: string, setId: string): Promise<void> {
    const row = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
    });
    if (!row.Item) return;
    const data = unmarshall(row.Item) as Record<string, unknown>;
    const ids = ((data.SampleIds as string[]) || []).filter((id) => id !== setId);
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
        UpdateExpression: 'SET SampleIds = :ids, ModifiedAt = :ma',
        ExpressionAttributeValues: marshall({
          ':ids': ids,
          ':ma': new Date().toISOString(),
        }),
      });
    }
  }

  private async getFileRowSampleIds(laboratoryId: string, ref: string): Promise<string[]> {
    const res = await this.getItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skFile(ref) }),
      ConsistentRead: true,
    });
    if (!res.Item) return [];
    const data = unmarshall(res.Item) as Record<string, unknown>;
    return (data.SampleIds as string[]) || [];
  }

  private async adjustSampleFileCount(
    laboratoryId: string,
    setId: string,
    delta: number,
    userId: string,
  ): Promise<void> {
    if (delta === 0) return;
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSample(setId) }),
      UpdateExpression: 'ADD FileCount :delta SET ModifiedAt = :ma, ModifiedBy = :mb',
      ExpressionAttributeValues: marshall({
        ':delta': delta,
        ':ma': new Date().toISOString(),
        ':mb': userId,
      }),
    });
  }

  private async adjustSequenceCollectionSampleCount(
    laboratoryId: string,
    collectionId: string,
    delta: number,
    userId: string,
  ): Promise<void> {
    const row = await this.getSequenceCollection(laboratoryId, collectionId);
    if (!row) return;
    const next = Math.max(0, (row.SampleCount || 0) + delta);
    await this.updateItem({
      TableName: TABLE_NAME,
      Key: marshall({ LaboratoryId: laboratoryId, Sk: skSequenceCollection(collectionId) }),
      UpdateExpression: 'SET SampleCount = :n, ModifiedAt = :ma, ModifiedBy = :mb',
      ExpressionAttributeValues: marshall({
        ':n': next,
        ':ma': new Date().toISOString(),
        ':mb': userId,
      }),
    });
  }

  private sampleRowToModel(
    row: Record<string, unknown>,
    kindIndex?: {
      batchTagIds: Set<string>;
      workflowTagIds: Set<string>;
      permanentTagIds: Set<string>;
    },
  ): LaboratorySample {
    const allTagIds = (row.TagIds as string[]) || [];
    let standardTagIds = allTagIds;
    let batchTagId: string | undefined;
    let workflowTagIds: string[] | undefined;
    let isPermanent: boolean | undefined;

    if (kindIndex) {
      const permanentIds = new Set(kindIndex.permanentTagIds);
      permanentIds.add(permanentTagIdForLaboratory(row.LaboratoryId as string));
      batchTagId = allTagIds.find((id) => kindIndex.batchTagIds.has(id));
      workflowTagIds = allTagIds.filter((id) => kindIndex.workflowTagIds.has(id));
      standardTagIds = allTagIds.filter(
        (id) => !kindIndex.batchTagIds.has(id) && !kindIndex.workflowTagIds.has(id) && !permanentIds.has(id),
      );
      isPermanent = allTagIds.some((id) => permanentIds.has(id));
    }

    return {
      SampleId: row.SampleId as string,
      Name: row.Name as string,
      Layout: row.Layout as SampleLayout,
      ...(row.FilenameRegex ? { FilenameRegex: row.FilenameRegex as string } : {}),
      ...(row.SampleIdPattern ? { SampleIdPattern: row.SampleIdPattern as string } : {}),
      FileCount: (row.FileCount as number) || 0,
      ...(standardTagIds.length ? { TagIds: standardTagIds } : {}),
      ...(batchTagId ? { BatchTagId: batchTagId } : {}),
      ...(workflowTagIds?.length ? { WorkflowTagIds: workflowTagIds } : {}),
      ...(isPermanent ? { IsPermanent: true } : {}),
      ...(row.ImportSource ? { ImportSource: row.ImportSource as SampleImportSource } : {}),
      ...(row.ContentsSummary ? { ContentsSummary: row.ContentsSummary as string } : {}),
      CreatedAt: row.CreatedAt as string | undefined,
      CreatedBy: row.CreatedBy as string | undefined,
      ModifiedAt: row.ModifiedAt as string | undefined,
      ModifiedBy: row.ModifiedBy as string | undefined,
    };
  }

  private sequenceCollectionRowToModel(row: Record<string, unknown>): LaboratorySequenceCollection {
    return {
      SequenceCollectionId: row.SequenceCollectionId as string,
      Name: row.Name as string,
      Columns: (row.Columns as SampleSheetColumnDef[]) || [],
      SampleCount: (row.SampleCount as number) || 0,
      ...(row.LastSampleSheetS3Url ? { LastSampleSheetS3Url: row.LastSampleSheetS3Url as string } : {}),
      CreatedAt: row.CreatedAt as string | undefined,
      CreatedBy: row.CreatedBy as string | undefined,
      ModifiedAt: row.ModifiedAt as string | undefined,
      ModifiedBy: row.ModifiedBy as string | undefined,
    };
  }
}

export { decodeS3ObjectRef, encodeS3ObjectRef };
