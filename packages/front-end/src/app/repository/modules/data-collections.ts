import {
  LaboratoryDataTag,
  ListFileTagsResponse,
  ListFilesByTagResponse,
  ListLaboratoryDataTagsResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import HttpFactory from '@FE/repository/factory';

export type RequestLaboratoryBucketObjectsBody = {
  LaboratoryId: string;
  RelativePrefix?: string;
  /** When true, returns all file objects under the prefix (flat), paginated until MaxTotalKeys. */
  Recursive?: boolean;
  /** Cap for recursive listing (default 15000, max 50000). */
  MaxTotalKeys?: number;
  MaxKeys?: number;
};

export type LaboratoryBucketObjectsResponse = {
  Contents?: Array<{ Key: string; LastModified?: string; Size?: number; ETag?: string; StorageClass?: string }>;
  CommonPrefixes?: Array<{ Prefix: string }>;
  IsTruncated: boolean;
  S3Bucket: string;
  ResolvedPrefix: string;
  Recursive?: boolean;
  /** True when recursive listing stopped early because {@link MaxTotalKeys} was reached. */
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
}

export default DataCollectionsModule;
