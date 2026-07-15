import {
  BatchUpdateLaboratoryS3AccessRequest,
  ListGrantedLaboratoryBucketsResponse,
  ListLaboratoryS3AccessAssignmentsResponse,
  ListS3BucketCatalogResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import HttpFactory from '@FE/repository/factory';

class S3AccessModule extends HttpFactory {
  async listCatalog(organizationId: string): Promise<ListS3BucketCatalogResponse> {
    const res = await this.call<ListS3BucketCatalogResponse>(
      'GET',
      `/organization/s3-access/list-s3-bucket-catalog?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (!res || !Array.isArray(res.buckets)) {
      throw new Error('Failed to load S3 bucket catalog');
    }
    return res;
  }

  async listAssignments(organizationId: string): Promise<ListLaboratoryS3AccessAssignmentsResponse> {
    const res = await this.call<ListLaboratoryS3AccessAssignmentsResponse>(
      'GET',
      `/organization/s3-access/list-s3-access-assignments?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (!res || !Array.isArray(res.assignments)) {
      throw new Error('Failed to load S3 access assignments');
    }
    return res;
  }

  async batchUpdate(organizationId: string, body: BatchUpdateLaboratoryS3AccessRequest): Promise<void> {
    const res = await this.call<{ ok?: boolean }>(
      'POST',
      `/organization/s3-access/edit-s3-access-batch?organizationId=${encodeURIComponent(organizationId)}`,
      body,
    );
    if (!res?.ok) {
      throw new Error('Failed to save S3 access');
    }
  }

  async listGrantedBuckets(laboratoryId: string): Promise<ListGrantedLaboratoryBucketsResponse> {
    const res = await this.call<ListGrantedLaboratoryBucketsResponse>(
      'GET',
      `/laboratory/s3-access/list-granted-buckets?laboratoryId=${encodeURIComponent(laboratoryId)}`,
    );
    if (!res || !Array.isArray(res.buckets)) {
      throw new Error('Failed to load granted S3 buckets');
    }
    return res;
  }
}

export default S3AccessModule;
