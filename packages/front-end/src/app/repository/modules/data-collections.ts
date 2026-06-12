import {
  BulkCreateSamplesResponse,
  LaboratoryDataTag,
  ListFileTagsResponse,
  ListFilesByTagResponse,
  ListLaboratoryDataTagsResponse,
  UnlinkedBucketObjectsResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import type {
  GenerateSequenceCollectionSampleSheetResponse,
  LaboratorySequenceCollection,
  LaboratorySample,
  ListLaboratorySequenceCollectionsResponse,
  ListLaboratorySamplesResponse,
  ListSampleTagsResponse,
  ListSamplesByTagResponse,
  SampleSheetColumnDef,
  SampleLayout,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/samples';
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

  async assignSampleBatch(body: {
    LaboratoryId: string;
    SampleIds: string[];
    ClearBatch?: boolean;
    BatchTagId?: string;
    NewBatchName?: string;
  }): Promise<void> {
    await this.call('POST', '/data-collections/edit-sample-batch', body);
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

  async listSamples(laboratoryId: string): Promise<ListLaboratorySamplesResponse> {
    const res = await this.call<ListLaboratorySamplesResponse>(
      'GET',
      `/data-collections/list-samples?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
    if (!res) throw new Error('Failed to list samples');
    return res;
  }

  async createSample(body: {
    LaboratoryId: string;
    S3Bucket: string;
    Name?: string;
    Layout: SampleLayout;
    FilenameRegex?: string;
    SampleIdPattern?: string;
    Keys?: string[];
    ExistingSampleId?: string;
    ExpandRegexFromListing?: boolean;
  }): Promise<LaboratorySample> {
    const res = await this.call<LaboratorySample>('POST', '/data-collections/create-sample', body);
    if (!res) throw new Error('Failed to create sample');
    return res;
  }

  async addFilesToSample(body: {
    LaboratoryId: string;
    S3Bucket: string;
    SampleId: string;
    Keys: string[];
  }): Promise<void> {
    await this.call('POST', '/data-collections/add-files-to-sample', body);
  }

  async listSequenceCollections(laboratoryId: string): Promise<ListLaboratorySequenceCollectionsResponse> {
    const res = await this.call<ListLaboratorySequenceCollectionsResponse>(
      'GET',
      `/data-collections/list-sequence-collections?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
    if (!res) throw new Error('Failed to list sequence collections');
    return res;
  }

  async listSequenceCollectionSamples(
    laboratoryId: string,
    sequenceCollectionId: string,
  ): Promise<{ SampleIds: string[] }> {
    const q = new URLSearchParams({ laboratoryId, sequenceCollectionId });
    const res = await this.call<{ SampleIds: string[] }>(
      'GET',
      `/data-collections/list-sequence-collection-samples?${q.toString()}`,
    );
    if (!res) throw new Error('Failed to list sequence collection samples');
    return res;
  }

  async createSequenceCollection(body: {
    LaboratoryId: string;
    Name?: string;
    Columns: SampleSheetColumnDef[];
    SampleIds?: string[];
    ExistingSequenceCollectionId?: string;
  }): Promise<LaboratorySequenceCollection> {
    const res = await this.call<LaboratorySequenceCollection>(
      'POST',
      '/data-collections/create-sequence-collection',
      body,
    );
    if (!res) throw new Error('Failed to create sequence collection');
    return res;
  }

  async generateSequenceCollectionSampleSheet(body: {
    LaboratoryId: string;
    S3Bucket: string;
    SequenceCollectionId: string;
    Platform: 'AWS HealthOmics' | 'Seqera Cloud';
    TransactionId: string;
    SampleSheetName: string;
    ValidateS3FilesExist?: boolean;
  }): Promise<GenerateSequenceCollectionSampleSheetResponse> {
    const res = await this.call<GenerateSequenceCollectionSampleSheetResponse>(
      'POST',
      '/data-collections/generate-sequence-collection-sample-sheet',
      body,
    );
    if (!res) throw new Error('Failed to generate sample sheet');
    return res;
  }

  async addTagsToSamples(body: {
    LaboratoryId: string;
    SampleIds: string[];
    AddTagIds?: string[];
    RemoveTagIds?: string[];
  }): Promise<void> {
    await this.call('POST', '/data-collections/add-tags-to-samples', body);
  }

  async requestListSampleTags(body: { LaboratoryId: string; SampleIds: string[] }): Promise<ListSampleTagsResponse> {
    const res = await this.call<ListSampleTagsResponse>('POST', '/data-collections/request-list-sample-tags', body);
    if (!res) throw new Error('Failed to list sample tags');
    return res;
  }

  async listSamplesByTag(
    laboratoryId: string,
    tagId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<ListSamplesByTagResponse> {
    const q = new URLSearchParams({ laboratoryId, tagId });
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.cursor) q.set('cursor', opts.cursor);
    const res = await this.call<ListSamplesByTagResponse>(
      'GET',
      `/data-collections/list-samples-by-tag?${q.toString()}`,
    );
    if (!res) throw new Error('Failed to list samples by tag');
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

  async bulkCreateSamples(body: {
    LaboratoryId: string;
    S3Bucket: string;
    ImportLabel: string;
    Samples: Array<{
      Name: string;
      Layout: SampleLayout;
      Keys: string[];
      TagIds?: string[];
      FilenameRegex?: string;
      SampleIdPattern?: string;
    }>;
    CopyJobs?: Array<{ SourceBucket: string; SourceKey: string; DestKey: string }>;
    NewBatchName?: string;
    BatchTagId?: string;
  }): Promise<BulkCreateSamplesResponse> {
    const res = await this.call<BulkCreateSamplesResponse>('POST', '/data-collections/create-bulk-samples', body);
    if (!res) throw new Error('Failed to bulk create samples');
    return res;
  }

  async addSamplesToSequenceCollection(body: {
    LaboratoryId: string;
    SequenceCollectionId: string;
    SampleIds: string[];
  }): Promise<void> {
    await this.call('POST', '/data-collections/add-samples-to-sequence-collection', body);
  }

  async updateSequenceCollectionSchema(body: {
    LaboratoryId: string;
    SequenceCollectionId: string;
    Columns: SampleSheetColumnDef[];
  }): Promise<LaboratorySequenceCollection> {
    const res = await this.call<LaboratorySequenceCollection>(
      'POST',
      '/data-collections/update-sequence-collection-schema',
      body,
    );
    if (!res) throw new Error('Failed to update sequence collection schema');
    return res;
  }

  async deleteSequenceCollection(laboratoryId: string, sequenceCollectionId: string): Promise<void> {
    await this.call(
      'DELETE',
      `/data-collections/delete-sequence-collection/${encodeURIComponent(sequenceCollectionId)}?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
  }

  async updateSequenceCollection(body: {
    LaboratoryId: string;
    SequenceCollectionId: string;
    Name: string;
    Columns: SampleSheetColumnDef[];
    SampleIds: string[];
  }): Promise<LaboratorySequenceCollection> {
    const res = await this.call<LaboratorySequenceCollection>(
      'POST',
      '/data-collections/edit-sequence-collection',
      body,
    );
    if (!res) throw new Error('Failed to update sequence collection');
    return res;
  }
}

export default DataCollectionsModule;
