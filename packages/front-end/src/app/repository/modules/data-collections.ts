import {
  BulkCreateSequenceSetsResponse,
  LaboratoryDataTag,
  ListFileTagsResponse,
  ListFilesByTagResponse,
  ListLaboratoryDataTagsResponse,
  UnlinkedBucketObjectsResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import type {
  GenerateDataCollectionSampleSheetResponse,
  LaboratoryRunDataCollection,
  LaboratorySequenceSet,
  ListLaboratoryRunDataCollectionsResponse,
  ListLaboratorySequenceSetsResponse,
  ListSequenceSetTagsResponse,
  ListSequenceSetsByTagResponse,
  SampleSheetColumnDef,
  SequenceSetLayout,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
import HttpFactory from '@FE/repository/factory';

export type RequestLaboratoryBucketObjectsBody = {
  LaboratoryId: string;
  RelativePrefix?: string;
  /** Cap on file objects returned (default 15000, max 50000). */
  MaxTotalKeys?: number;
  /** Cap on transaction folders walked (default 10000, max 50000). */
  MaxTransactionFolders?: number;
  MaxKeys?: number;
};

export type LaboratoryBucketObjectsResponse = {
  Contents?: Array<{ Key: string; LastModified?: string; Size?: number; ETag?: string; StorageClass?: string }>;
  CommonPrefixes?: Array<{ Prefix: string }>;
  IsTruncated: boolean;
  S3Bucket: string;
  ResolvedPrefix: string;
  /** True when listing stopped early because a cap was reached. */
  ListingTruncated?: boolean;
  ReturnedKeyCount?: number;
};

class DataCollectionsModule extends HttpFactory {
  async listTags(laboratoryId: string): Promise<ListLaboratoryDataTagsResponse> {
    const res = await this.call<ListLaboratoryDataTagsResponse>(
      'GET',
      `/data-collections/list-tags?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
    if (!res) throw new Error('Failed to list tags');
    return res;
  }

  async createTag(body: { LaboratoryId: string; Name: string; ColorHex: string }): Promise<LaboratoryDataTag> {
    const res = await this.call<LaboratoryDataTag>('POST', '/data-collections/create-tag', body);
    if (!res) throw new Error('Failed to create tag');
    return res;
  }

  async updateTag(
    tagId: string,
    body: { LaboratoryId: string; Name?: string; ColorHex?: string },
  ): Promise<LaboratoryDataTag> {
    const res = await this.call<LaboratoryDataTag>(
      'PUT',
      `/data-collections/update-tag/${encodeURIComponent(tagId)}`,
      body,
    );
    if (!res) throw new Error('Failed to update tag');
    return res;
  }

  async deleteTag(laboratoryId: string, tagId: string): Promise<void> {
    await this.call(
      'DELETE',
      `/data-collections/delete-tag/${encodeURIComponent(tagId)}?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
  }

  async requestListFileTags(body: {
    LaboratoryId: string;
    S3Bucket: string;
    Keys: string[];
  }): Promise<ListFileTagsResponse> {
    const res = await this.call<ListFileTagsResponse>('POST', '/data-collections/request-list-file-tags', body);
    if (!res) throw new Error('Failed to list file tags');
    return res;
  }

  async addTagsToFiles(body: {
    LaboratoryId: string;
    S3Bucket: string;
    Keys: string[];
    AddTagIds?: string[];
    RemoveTagIds?: string[];
  }): Promise<void> {
    await this.call('POST', '/data-collections/add-tags-to-files', body);
  }

  async assignBatch(body: {
    LaboratoryId: string;
    S3Bucket: string;
    Keys: string[];
    ClearBatch?: boolean;
    BatchTagId?: string;
    NewBatchName?: string;
  }): Promise<void> {
    await this.call('POST', '/data-collections/edit-batch', body);
  }

  async listFilesByTag(
    laboratoryId: string,
    tagId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<ListFilesByTagResponse> {
    const q = new URLSearchParams({ laboratoryId, tagId });
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.cursor) q.set('cursor', opts.cursor);
    const res = await this.call<ListFilesByTagResponse>('GET', `/data-collections/list-files-by-tag?${q.toString()}`);
    if (!res) throw new Error('Failed to list files by tag');
    return res;
  }

  async requestLaboratoryBucketObjects(
    body: RequestLaboratoryBucketObjectsBody,
  ): Promise<LaboratoryBucketObjectsResponse> {
    const res = await this.call<LaboratoryBucketObjectsResponse>(
      'POST',
      '/data-collections/request-laboratory-bucket-objects',
      body,
    );
    if (!res) throw new Error('Failed to list bucket objects');
    return res;
  }

  async listSequenceSets(laboratoryId: string): Promise<ListLaboratorySequenceSetsResponse> {
    const res = await this.call<ListLaboratorySequenceSetsResponse>(
      'GET',
      `/data-collections/list-sequence-sets?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
    if (!res) throw new Error('Failed to list sequence sets');
    return res;
  }

  async createSequenceSet(body: {
    LaboratoryId: string;
    S3Bucket: string;
    Name?: string;
    Layout: SequenceSetLayout;
    FilenameRegex?: string;
    SampleIdPattern?: string;
    Keys?: string[];
    ExistingSequenceSetId?: string;
    ExpandRegexFromListing?: boolean;
  }): Promise<LaboratorySequenceSet> {
    const res = await this.call<LaboratorySequenceSet>('POST', '/data-collections/create-sequence-set', body);
    if (!res) throw new Error('Failed to create sequence set');
    return res;
  }

  async addFilesToSequenceSet(body: {
    LaboratoryId: string;
    S3Bucket: string;
    SequenceSetId: string;
    Keys: string[];
  }): Promise<void> {
    await this.call('POST', '/data-collections/add-files-to-sequence-set', body);
  }

  async listDataCollections(laboratoryId: string): Promise<ListLaboratoryRunDataCollectionsResponse> {
    const res = await this.call<ListLaboratoryRunDataCollectionsResponse>(
      'GET',
      `/data-collections/list-data-collections?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
    if (!res) throw new Error('Failed to list data collections');
    return res;
  }

  async listDataCollectionSequenceSets(
    laboratoryId: string,
    dataCollectionId: string,
  ): Promise<{ SequenceSetIds: string[] }> {
    const q = new URLSearchParams({ laboratoryId, dataCollectionId });
    const res = await this.call<{ SequenceSetIds: string[] }>(
      'GET',
      `/data-collections/list-data-collection-sequence-sets?${q.toString()}`,
    );
    if (!res) throw new Error('Failed to list data collection sequence sets');
    return res;
  }

  async createDataCollection(body: {
    LaboratoryId: string;
    Name?: string;
    Columns: SampleSheetColumnDef[];
    SequenceSetIds?: string[];
    ExistingDataCollectionId?: string;
  }): Promise<LaboratoryRunDataCollection> {
    const res = await this.call<LaboratoryRunDataCollection>('POST', '/data-collections/create-data-collection', body);
    if (!res) throw new Error('Failed to create data collection');
    return res;
  }

  async generateDataCollectionSampleSheet(body: {
    LaboratoryId: string;
    S3Bucket: string;
    DataCollectionId: string;
    Platform: 'AWS HealthOmics' | 'Seqera Cloud';
    TransactionId: string;
    SampleSheetName: string;
    ValidateS3FilesExist?: boolean;
  }): Promise<GenerateDataCollectionSampleSheetResponse> {
    const res = await this.call<GenerateDataCollectionSampleSheetResponse>(
      'POST',
      '/data-collections/generate-data-collection-sample-sheet',
      body,
    );
    if (!res) throw new Error('Failed to generate sample sheet');
    return res;
  }

  async addTagsToSequenceSets(body: {
    LaboratoryId: string;
    SequenceSetIds: string[];
    AddTagIds?: string[];
    RemoveTagIds?: string[];
  }): Promise<void> {
    await this.call('POST', '/data-collections/add-tags-to-sequence-sets', body);
  }

  async requestListSequenceSetTags(body: {
    LaboratoryId: string;
    SequenceSetIds: string[];
  }): Promise<ListSequenceSetTagsResponse> {
    const res = await this.call<ListSequenceSetTagsResponse>(
      'POST',
      '/data-collections/request-list-sequence-set-tags',
      body,
    );
    if (!res) throw new Error('Failed to list sequence set tags');
    return res;
  }

  async listSequenceSetsByTag(
    laboratoryId: string,
    tagId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<ListSequenceSetsByTagResponse> {
    const q = new URLSearchParams({ laboratoryId, tagId });
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.cursor) q.set('cursor', opts.cursor);
    const res = await this.call<ListSequenceSetsByTagResponse>(
      'GET',
      `/data-collections/list-sequence-sets-by-tag?${q.toString()}`,
    );
    if (!res) throw new Error('Failed to list sequence sets by tag');
    return res;
  }

  async requestUnlinkedBucketObjects(body: RequestLaboratoryBucketObjectsBody): Promise<UnlinkedBucketObjectsResponse> {
    const res = await this.call<UnlinkedBucketObjectsResponse>(
      'POST',
      '/data-collections/request-unlinked-bucket-objects',
      body,
    );
    if (!res) throw new Error('Failed to list unlinked bucket objects');
    return res;
  }

  async bulkCreateSequenceSets(body: {
    LaboratoryId: string;
    S3Bucket: string;
    ImportLabel: string;
    SequenceSets: Array<{
      Name: string;
      Layout: SequenceSetLayout;
      Keys: string[];
      TagIds?: string[];
      FilenameRegex?: string;
      SampleIdPattern?: string;
    }>;
    CopyJobs?: Array<{ SourceBucket: string; SourceKey: string; DestKey: string }>;
  }): Promise<BulkCreateSequenceSetsResponse> {
    const res = await this.call<BulkCreateSequenceSetsResponse>(
      'POST',
      '/data-collections/create-bulk-sequence-sets',
      body,
    );
    if (!res) throw new Error('Failed to bulk create sequence sets');
    return res;
  }

  async addSequenceSetsToDataCollection(body: {
    LaboratoryId: string;
    DataCollectionId: string;
    SequenceSetIds: string[];
  }): Promise<void> {
    await this.call('POST', '/data-collections/add-sequence-sets-to-data-collection', body);
  }

  async updateDataCollectionSchema(body: {
    LaboratoryId: string;
    DataCollectionId: string;
    Columns: SampleSheetColumnDef[];
  }): Promise<LaboratoryRunDataCollection> {
    const res = await this.call<LaboratoryRunDataCollection>(
      'POST',
      '/data-collections/update-data-collection-schema',
      body,
    );
    if (!res) throw new Error('Failed to update data collection schema');
    return res;
  }

  async updateDataCollection(body: {
    LaboratoryId: string;
    DataCollectionId: string;
    Name: string;
    Columns: SampleSheetColumnDef[];
    SequenceSetIds: string[];
  }): Promise<LaboratoryRunDataCollection> {
    const res = await this.call<LaboratoryRunDataCollection>('POST', '/data-collections/update-data-collection', body);
    if (!res) throw new Error('Failed to update data collection');
    return res;
  }
}

export default DataCollectionsModule;
