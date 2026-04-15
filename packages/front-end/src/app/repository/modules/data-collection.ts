import {
  BatchGetDataCollectionFileTagsResponseSchema,
  BatchSetDataCollectionFileTagsResponseSchema,
  CreateDataCollectionTagResponseSchema,
  DeleteDataCollectionTagResponseSchema,
  ListDataCollectionTagsResponseSchema,
  UpdateDataCollectionTagResponseSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collection/data-collection';
import {
  BatchGetDataCollectionFileTagsRequest,
  BatchGetDataCollectionFileTagsResponse,
  BatchSetDataCollectionFileTagsRequest,
  BatchSetDataCollectionFileTagsResponse,
  CreateDataCollectionTagRequest,
  CreateDataCollectionTagResponse,
  DeleteDataCollectionTagRequest,
  DeleteDataCollectionTagResponse,
  ListDataCollectionTagsResponse,
  UpdateDataCollectionTagRequest,
  UpdateDataCollectionTagResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collection';
import HttpFactory from '@FE/repository/factory';
import { validateApiResponse } from '@FE/utils/api-utils';

class DataCollectionModule extends HttpFactory {
  async listDataCollectionTags(laboratoryId: string): Promise<ListDataCollectionTagsResponse> {
    const res = await this.call<ListDataCollectionTagsResponse>(
      'GET',
      `/data-collection/list-data-collection-tags?LaboratoryId=${encodeURIComponent(laboratoryId)}`,
      '',
    );
    if (!res) {
      throw new Error('Failed to list data collection tags');
    }
    validateApiResponse(ListDataCollectionTagsResponseSchema, res);
    return res;
  }

  async createDataCollectionTag(req: CreateDataCollectionTagRequest): Promise<CreateDataCollectionTagResponse> {
    const res = await this.call<CreateDataCollectionTagResponse>(
      'POST',
      '/data-collection/create-data-collection-tag',
      req,
    );
    if (!res) {
      throw new Error('Failed to create tag');
    }
    validateApiResponse(CreateDataCollectionTagResponseSchema, res);
    return res;
  }

  async editDataCollectionTag(req: UpdateDataCollectionTagRequest): Promise<UpdateDataCollectionTagResponse> {
    const res = await this.call<UpdateDataCollectionTagResponse>(
      'POST',
      '/data-collection/edit-data-collection-tag',
      req,
    );
    if (!res) {
      throw new Error('Failed to update tag');
    }
    validateApiResponse(UpdateDataCollectionTagResponseSchema, res);
    return res;
  }

  async removeDataCollectionTag(req: DeleteDataCollectionTagRequest): Promise<DeleteDataCollectionTagResponse> {
    const res = await this.call<DeleteDataCollectionTagResponse>(
      'POST',
      '/data-collection/remove-data-collection-tag',
      req,
    );
    if (!res) {
      throw new Error('Failed to remove tag');
    }
    validateApiResponse(DeleteDataCollectionTagResponseSchema, res);
    return res;
  }

  async requestBatchGetDataCollectionFileTags(
    req: BatchGetDataCollectionFileTagsRequest,
  ): Promise<BatchGetDataCollectionFileTagsResponse> {
    const res = await this.call<BatchGetDataCollectionFileTagsResponse>(
      'POST',
      '/data-collection/request-batch-get-data-collection-file-tags',
      req,
    );
    if (!res) {
      throw new Error('Failed to batch get file tags');
    }
    validateApiResponse(BatchGetDataCollectionFileTagsResponseSchema, res);
    return res;
  }

  async requestBatchSetDataCollectionFileTags(
    req: BatchSetDataCollectionFileTagsRequest,
  ): Promise<BatchSetDataCollectionFileTagsResponse> {
    const res = await this.call<BatchSetDataCollectionFileTagsResponse>(
      'POST',
      '/data-collection/request-batch-set-data-collection-file-tags',
      req,
    );
    if (!res) {
      throw new Error('Failed to batch set file tags');
    }
    validateApiResponse(BatchSetDataCollectionFileTagsResponseSchema, res);
    return res;
  }
}

export default DataCollectionModule;
