import { ZodTypeAny } from 'zod';
import { CreateRunRequestSchema } from '../schema/aws-healthomics/aws-healthomics-api';
import { AddTagsToFilesSchema } from '../schema/easy-genomics/data-collections/add-tags-to-files';
import {
  AddTagsToSamplesSchema,
  RequestListSampleTagsSchema,
} from '../schema/easy-genomics/data-collections/add-tags-to-samples';
import { AssignBatchSchema } from '../schema/easy-genomics/data-collections/assign-batch';
import { AssignSampleBatchSchema } from '../schema/easy-genomics/data-collections/assign-sample-batch';
import { BulkCreateSamplesSchema } from '../schema/easy-genomics/data-collections/bulk-create-samples';
import {
  AddFilesToSampleSchema,
  CreateSampleSchema,
  RemoveFilesFromSampleSchema,
} from '../schema/easy-genomics/data-collections/create-sample';
import {
  AddSamplesToSequenceCollectionSchema,
  CreateSequenceCollectionSchema,
  GenerateSequenceCollectionSampleSheetSchema,
  UpdateSequenceCollectionSchema,
  UpdateSequenceCollectionSchemaSchema,
} from '../schema/easy-genomics/data-collections/create-sequence-collection';
import { CreateLaboratoryDataTagSchema } from '../schema/easy-genomics/data-collections/create-tag';
import { RequestLaboratoryBucketObjectsSchema } from '../schema/easy-genomics/data-collections/request-laboratory-bucket-objects';
import { RequestListFileTagsSchema } from '../schema/easy-genomics/data-collections/request-list-file-tags';
import { RequestUnlinkedBucketObjectsSchema } from '../schema/easy-genomics/data-collections/request-unlinked-bucket-objects';
import { UpdateLaboratoryDataTagSchema } from '../schema/easy-genomics/data-collections/update-tag';
import { RequestFileDownloadUrlSchema } from '../schema/easy-genomics/file/request-file-download-url';
import { RequestFolderDownloadJobSchema } from '../schema/easy-genomics/file/request-folder-download-job';
import { RequestFolderDownloadJobStatusSchema } from '../schema/easy-genomics/file/request-folder-download-job-status';
import { RequestListBucketObjectsSchema } from '../schema/easy-genomics/file/request-list-bucket-objects';
import { RequestSearchBucketObjectsSchema } from '../schema/easy-genomics/file/request-search-bucket-objects';
import { RequestTopLevelBucketObjectsSchema } from '../schema/easy-genomics/file/request-top-level-bucket-objects';
import {
  CreateLaboratorySchema,
  UpdateLaboratorySchema,
  RequestLaboratorySchema,
} from '../schema/easy-genomics/laboratory';
import { AddLaboratoryRunSchema, EditLaboratoryRunSchema } from '../schema/easy-genomics/laboratory-run';
import { BatchUpdateLaboratoryS3AccessRequestSchema } from '../schema/easy-genomics/laboratory-s3-access';
import {
  AddBulkLaboratoryUsersSchema,
  AddLaboratoryUserSchema,
  EditLaboratoryUserSchema,
  RemoveLaboratoryUserSchema,
  RequestLaboratoryUserSchema,
} from '../schema/easy-genomics/laboratory-user';
import { BatchUpdateLaboratoryWorkflowAccessRequestSchema } from '../schema/easy-genomics/laboratory-workflow-access';
import { CreateOrganizationSchema, UpdateOrganizationSchema } from '../schema/easy-genomics/organization';
import {
  AddOrganizationUserSchema,
  EditOrganizationUserSchema,
  RemoveOrganizationUserSchema,
  RequestOrganizationUserSchema,
} from '../schema/easy-genomics/organization-user';
import { FileUploadRequestSchema } from '../schema/easy-genomics/upload/s3-file-upload-manifest';
import { SampleSheetRequestSchema } from '../schema/easy-genomics/upload/s3-file-upload-sample-sheet';
import { UpdateUserSchema, UpdateUserLastAccessedInfoSchema } from '../schema/easy-genomics/user';
import {
  CreateUserInvitationRequestSchema,
  CreateBulkUserInvitationRequestSchema,
  ConfirmUpdateUserInvitationRequestSchema,
} from '../schema/easy-genomics/user-invitation';
import {
  CreateUserForgotPasswordRequestSchema,
  ConfirmUserForgotPasswordRequestSchema,
} from '../schema/easy-genomics/user-password';

export interface QueryParam {
  name: string;
  required: boolean;
  description?: string;
}

export interface RouteSchema {
  request?: ZodTypeAny;
  response?: string;
  query?: QueryParam[];
  public?: true;
}

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  // ── easy-genomics/ ──────────────────────────────────────────────────────────

  'GET /easy-genomics/list-buckets': {},

  // Public Swagger UI page for this API. Returns HTML, not JSON; no request/response schema.
  'GET /easy-genomics/list-api-docs': { public: true },

  // ── easy-genomics/organization/ ─────────────────────────────────────────────

  'POST /easy-genomics/organization/create-organization': {
    request: CreateOrganizationSchema,
    response: 'Organization',
  },
  'GET /easy-genomics/organization/read-organization/{id}': {
    response: 'Organization',
  },
  'PUT /easy-genomics/organization/update-organization/{id}': {
    request: UpdateOrganizationSchema,
    response: 'Organization',
  },
  'DELETE /easy-genomics/organization/delete-organization/{id}': {},
  'GET /easy-genomics/organization/list-organizations': {
    response: 'Organization',
  },

  // ── easy-genomics/organization/user/ ─────────────────────────────────────────

  'POST /easy-genomics/organization/user/add-organization-user': {
    request: AddOrganizationUserSchema,
    response: 'OrganizationUser',
  },
  'POST /easy-genomics/organization/user/edit-organization-user': {
    request: EditOrganizationUserSchema,
    response: 'OrganizationUser',
  },
  'GET /easy-genomics/organization/user/list-organization-users': {
    response: 'OrganizationUser',
    query: [
      { name: 'organizationId', required: false, description: 'Filter by organization' },
      { name: 'userId', required: false, description: 'Filter by user' },
    ],
  },
  'GET /easy-genomics/organization/user/list-organization-users-details': {
    response: 'OrganizationUserDetails',
    query: [{ name: 'organizationId', required: false, description: 'Filter by organization' }],
  },
  'POST /easy-genomics/organization/user/remove-organization-user': {
    request: RemoveOrganizationUserSchema,
  },
  'POST /easy-genomics/organization/user/request-organization-user': {
    request: RequestOrganizationUserSchema,
    response: 'OrganizationUser',
  },

  // ── easy-genomics/organization/workflow-access/ ──────────────────────────────

  'POST /easy-genomics/organization/workflow-access/edit-workflow-access-batch': {
    request: BatchUpdateLaboratoryWorkflowAccessRequestSchema,
  },
  'GET /easy-genomics/organization/workflow-access/list-workflow-access-assignments': {
    response: 'ListLaboratoryWorkflowAccessAssignmentsResponse',
    query: [{ name: 'organizationId', required: false, description: 'Filter by organization' }],
  },
  'GET /easy-genomics/organization/workflow-access/list-workflow-catalog': {
    response: 'ListUnifiedWorkflowCatalogResponse',
    query: [{ name: 'organizationId', required: false, description: 'Filter by organization' }],
  },

  // ── easy-genomics/organization/s3-access/ ─────────────────────────────────────

  'POST /easy-genomics/organization/s3-access/edit-s3-access-batch': {
    request: BatchUpdateLaboratoryS3AccessRequestSchema,
  },
  'GET /easy-genomics/organization/s3-access/list-s3-access-assignments': {
    response: 'ListLaboratoryS3AccessAssignmentsResponse',
    query: [{ name: 'organizationId', required: false, description: 'Filter by organization' }],
  },
  'GET /easy-genomics/organization/s3-access/list-s3-bucket-catalog': {
    response: 'ListS3BucketCatalogResponse',
    query: [{ name: 'organizationId', required: false, description: 'Filter by organization' }],
  },

  // ── easy-genomics/laboratory/s3-access/ ─────────────────────────────────────

  'GET /easy-genomics/laboratory/s3-access/list-granted-buckets': {
    response: 'ListGrantedLaboratoryBucketsResponse',
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory ID' }],
  },

  // ── easy-genomics/laboratory/ ────────────────────────────────────────────────

  'POST /easy-genomics/laboratory/create-laboratory': {
    request: CreateLaboratorySchema,
    response: 'Laboratory',
  },
  'GET /easy-genomics/laboratory/read-laboratory/{id}': {
    response: 'ReadLaboratory',
  },
  'PUT /easy-genomics/laboratory/update-laboratory/{id}': {
    request: UpdateLaboratorySchema,
    response: 'Laboratory',
  },
  'DELETE /easy-genomics/laboratory/delete-laboratory/{id}': {},
  'GET /easy-genomics/laboratory/list-laboratories': {
    response: 'Laboratory',
  },
  'POST /easy-genomics/laboratory/request-laboratory': {
    request: RequestLaboratorySchema,
    response: 'ReadLaboratory',
  },

  // ── easy-genomics/laboratory/user/ ──────────────────────────────────────────

  'POST /easy-genomics/laboratory/user/add-laboratory-user': {
    request: AddLaboratoryUserSchema,
    response: 'LaboratoryUser',
  },
  'POST /easy-genomics/laboratory/user/add-bulk-laboratory-users': {
    request: AddBulkLaboratoryUsersSchema,
  },
  'POST /easy-genomics/laboratory/user/edit-laboratory-user': {
    request: EditLaboratoryUserSchema,
    response: 'LaboratoryUser',
  },
  'GET /easy-genomics/laboratory/user/list-laboratory-users': {
    response: 'LaboratoryUser',
    query: [
      { name: 'organizationId', required: false, description: 'Filter by organization' },
      { name: 'laboratoryId', required: false, description: 'Filter by laboratory' },
      { name: 'userId', required: false, description: 'Filter by user' },
    ],
  },
  'GET /easy-genomics/laboratory/user/list-laboratory-users-details': {
    response: 'LaboratoryUserDetails',
    query: [{ name: 'laboratoryId', required: false, description: 'Filter by laboratory' }],
  },
  'POST /easy-genomics/laboratory/user/remove-laboratory-user': {
    request: RemoveLaboratoryUserSchema,
  },
  'POST /easy-genomics/laboratory/user/request-laboratory-user': {
    request: RequestLaboratoryUserSchema,
    response: 'LaboratoryUser',
  },

  // ── easy-genomics/laboratory/run/ ────────────────────────────────────────────

  'POST /easy-genomics/laboratory/run/create-laboratory-run': {
    request: AddLaboratoryRunSchema,
    response: 'LaboratoryRun',
  },
  'GET /easy-genomics/laboratory/run/read-laboratory-run/{id}': {
    response: 'ReadLaboratoryRun',
  },
  'PUT /easy-genomics/laboratory/run/update-laboratory-run/{id}': {
    request: EditLaboratoryRunSchema,
    response: 'LaboratoryRun',
  },
  'DELETE /easy-genomics/laboratory/run/delete-laboratory-run/{id}': {},
  'GET /easy-genomics/laboratory/run/list-laboratory-runs': {
    response: 'ReadLaboratoryRun',
    query: [
      { name: 'LaboratoryId', required: true, description: 'Filter by laboratory (PascalCase matches the handler)' },
    ],
  },
  'POST /easy-genomics/laboratory/run/request-apply-run-retention-policy': {},
  'POST /easy-genomics/laboratory/run/request-laboratory-run-status-check': {},

  // ── easy-genomics/data-collections/ ─────────────────────────────────────────

  'POST /easy-genomics/data-collections/add-files-to-sample': {
    request: AddFilesToSampleSchema,
  },
  'POST /easy-genomics/data-collections/add-samples-to-sequence-collection': {
    request: AddSamplesToSequenceCollectionSchema,
  },
  'POST /easy-genomics/data-collections/add-tags-to-files': {
    request: AddTagsToFilesSchema,
  },
  'POST /easy-genomics/data-collections/add-tags-to-samples': {
    request: AddTagsToSamplesSchema,
  },
  'POST /easy-genomics/data-collections/create-bulk-samples': {
    request: BulkCreateSamplesSchema,
    response: 'BulkCreateSamplesResponse',
  },
  'POST /easy-genomics/data-collections/create-sample': {
    request: CreateSampleSchema,
    response: 'LaboratorySample',
  },
  'POST /easy-genomics/data-collections/create-sequence-collection': {
    request: CreateSequenceCollectionSchema,
    response: 'LaboratorySequenceCollection',
  },
  'POST /easy-genomics/data-collections/create-tag': {
    request: CreateLaboratoryDataTagSchema,
    response: 'LaboratoryDataTag',
  },
  'DELETE /easy-genomics/data-collections/delete-sequence-collection/{id}': {
    query: [{ name: 'laboratoryId', required: true, description: 'Laboratory that owns the sequence collection' }],
  },
  'DELETE /easy-genomics/data-collections/delete-tag/{id}': {},
  'POST /easy-genomics/data-collections/edit-batch': {
    request: AssignBatchSchema,
  },
  'POST /easy-genomics/data-collections/edit-sample-batch': {
    request: AssignSampleBatchSchema,
  },
  'POST /easy-genomics/data-collections/edit-sequence-collection': {
    request: UpdateSequenceCollectionSchema,
    response: 'LaboratorySequenceCollection',
  },
  'GET /easy-genomics/data-collections/list-files-by-tag': {
    response: 'ListFilesByTagResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to query' },
      { name: 'tagId', required: false, description: 'Tag to list files for' },
      { name: 'limit', required: false, description: 'Max number of results (1-500)' },
      { name: 'cursor', required: false, description: 'Pagination cursor' },
    ],
  },
  'GET /easy-genomics/data-collections/list-sample-files': {
    response: 'ListSampleFilesResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to query' },
      { name: 'sampleId', required: false, description: 'Sample to list files for' },
      { name: 'limit', required: false, description: 'Max number of results (1-500)' },
      { name: 'cursor', required: false, description: 'Pagination cursor' },
    ],
  },
  'GET /easy-genomics/data-collections/list-samples': {
    response: 'ListLaboratorySamplesResponse',
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to list samples for' }],
  },
  'GET /easy-genomics/data-collections/list-samples-by-tag': {
    response: 'ListSamplesByTagResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to query' },
      { name: 'tagId', required: false, description: 'Tag to list samples for' },
      { name: 'limit', required: false, description: 'Max number of results (1-500)' },
      { name: 'cursor', required: false, description: 'Pagination cursor' },
    ],
  },
  'GET /easy-genomics/data-collections/list-sequence-collection-samples': {
    response: 'ListSequenceCollectionSamplesResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to query' },
      { name: 'sequenceCollectionId', required: false, description: 'Sequence collection to list samples for' },
    ],
  },
  'GET /easy-genomics/data-collections/list-sequence-collections': {
    response: 'ListLaboratorySequenceCollectionsResponse',
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to list sequence collections for' }],
  },
  'GET /easy-genomics/data-collections/list-tags': {
    response: 'ListLaboratoryDataTagsResponse',
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to list tags for' }],
  },
  'POST /easy-genomics/data-collections/remove-files-from-sample': {
    request: RemoveFilesFromSampleSchema,
  },
  'POST /easy-genomics/data-collections/request-laboratory-bucket-objects': {
    request: RequestLaboratoryBucketObjectsSchema,
  },
  'POST /easy-genomics/data-collections/request-list-file-tags': {
    request: RequestListFileTagsSchema,
    response: 'ListFileTagsResponse',
  },
  'POST /easy-genomics/data-collections/request-list-sample-tags': {
    request: RequestListSampleTagsSchema,
    response: 'ListSampleTagsResponse',
  },
  'POST /easy-genomics/data-collections/request-sequence-collection-sample-sheet': {
    request: GenerateSequenceCollectionSampleSheetSchema,
    response: 'GenerateSequenceCollectionSampleSheetResponse',
  },
  'POST /easy-genomics/data-collections/request-unlinked-bucket-objects': {
    request: RequestUnlinkedBucketObjectsSchema,
    response: 'UnlinkedBucketObjectsResponse',
  },
  'PUT /easy-genomics/data-collections/update-sequence-collection-schema/{id}': {
    request: UpdateSequenceCollectionSchemaSchema,
    response: 'LaboratorySequenceCollection',
  },
  'PUT /easy-genomics/data-collections/update-tag/{id}': {
    request: UpdateLaboratoryDataTagSchema,
    response: 'LaboratoryDataTag',
  },

  // ── easy-genomics/file/ ──────────────────────────────────────────────────────

  'POST /easy-genomics/file/request-file-download-url': {
    request: RequestFileDownloadUrlSchema,
  },
  'POST /easy-genomics/file/request-folder-download-job': {
    request: RequestFolderDownloadJobSchema,
  },
  'POST /easy-genomics/file/request-folder-download-job-status': {
    request: RequestFolderDownloadJobStatusSchema,
  },
  'POST /easy-genomics/file/request-list-bucket-objects': {
    request: RequestListBucketObjectsSchema,
  },
  'POST /easy-genomics/file/request-search-bucket-objects': {
    request: RequestSearchBucketObjectsSchema,
  },
  'POST /easy-genomics/file/request-top-level-bucket-objects': {
    request: RequestTopLevelBucketObjectsSchema,
  },

  // ── easy-genomics/upload/ ────────────────────────────────────────────────────

  'POST /easy-genomics/upload/create-file-upload-request': {
    request: FileUploadRequestSchema,
  },
  'POST /easy-genomics/upload/create-file-upload-sample-sheet': {
    request: SampleSheetRequestSchema,
  },

  // ── easy-genomics/user/ ──────────────────────────────────────────────────────

  'POST /easy-genomics/user/confirm-user-forgot-password-request': {
    request: ConfirmUserForgotPasswordRequestSchema,
    public: true,
  },
  'POST /easy-genomics/user/confirm-user-invitation-request': {
    request: ConfirmUpdateUserInvitationRequestSchema,
    public: true,
  },
  'POST /easy-genomics/user/create-bulk-user-invitation-requests': {
    request: CreateBulkUserInvitationRequestSchema,
  },
  'POST /easy-genomics/user/create-user-forgot-password-request': {
    request: CreateUserForgotPasswordRequestSchema,
    public: true,
  },
  'POST /easy-genomics/user/create-user-invitation-request': {
    request: CreateUserInvitationRequestSchema,
  },
  'DELETE /easy-genomics/user/delete-user-request/{id}': {},
  'GET /easy-genomics/user/list-all-users': {
    response: 'User',
  },
  'GET /easy-genomics/user/list-user-self': {
    response: 'User',
  },
  'PUT /easy-genomics/user/update-user-last-accessed-info/{id}': {
    request: UpdateUserLastAccessedInfoSchema,
  },
  'PUT /easy-genomics/user/update-user-request/{id}': {
    request: UpdateUserSchema,
    response: 'User',
  },

  // ── aws-healthomics/run/ ─────────────────────────────────────────────────────

  'PUT /aws-healthomics/run/cancel-run-execution/{id}': {
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to verify HealthOmics access' }],
  },
  'POST /aws-healthomics/run/create-run-execution': {
    request: CreateRunRequestSchema,
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to verify HealthOmics access' }],
  },
  'GET /aws-healthomics/run/list-runs': {
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to list runs for' },
      { name: 'maxResults', required: false, description: 'Pagination page size' },
      { name: 'startingToken', required: false, description: 'Pagination offset token' },
      { name: 'name', required: false, description: 'Filter by run name' },
      { name: 'status', required: false, description: 'Filter by run status' },
    ],
  },
  'GET /aws-healthomics/run/read-run/{id}': {
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to verify HealthOmics access' }],
  },

  // ── aws-healthomics/workflow/ ────────────────────────────────────────────────

  'POST /aws-healthomics/workflow/create-private-workflow': {
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to create workflow under' }],
  },
  'POST /aws-healthomics/workflow/create-workflow-upload-request': {
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to upload workflow for' }],
  },
  'GET /aws-healthomics/workflow/list-private-workflows': {
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to list workflows for' },
      { name: 'maxResults', required: false, description: 'Pagination page size' },
      { name: 'startingToken', required: false, description: 'Pagination offset token' },
      { name: 'name', required: false, description: 'Filter by workflow name' },
    ],
  },
  'GET /aws-healthomics/workflow/list-shared-workflows': {
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to verify HealthOmics access' },
      { name: 'maxResults', required: false, description: 'Pagination page size' },
      { name: 'startingToken', required: false, description: 'Pagination offset token' },
      { name: 'name', required: false, description: 'Filter by workflow name' },
    ],
  },
  'GET /aws-healthomics/workflow/list-workflow-versions': {
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to verify HealthOmics access' },
      { name: 'workflowId', required: false, description: 'Workflow to list versions for' },
      { name: 'maxResults', required: false, description: 'Pagination page size' },
      { name: 'startingToken', required: false, description: 'Pagination offset token' },
    ],
  },
  'GET /aws-healthomics/workflow/read-private-workflow/{id}': {
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to verify HealthOmics access' }],
  },
  'GET /aws-healthomics/workflow/read-workflow-schema/{id}': {
    query: [{ name: 'laboratoryId', required: false, description: 'Laboratory to verify access' }],
  },

  // ── nf-tower/compute-env/ ────────────────────────────────────────────────────

  'GET /nf-tower/compute-env/list-compute-envs': {
    response: 'ListComputeEnvsResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/compute-env/read-compute-env/{id}': {
    response: 'DescribeComputeEnvsResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },

  // ── nf-tower/pipeline/ ───────────────────────────────────────────────────────

  'GET /nf-tower/pipeline/list-pipelines': {
    response: 'ListPipelinesResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/pipeline/read-pipeline/{id}': {
    response: 'DescribePipelinesResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/pipeline/read-pipeline-launch-details/{id}': {
    response: 'DescribePipelineLaunchResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/pipeline/read-pipeline-schema/{id}': {
    response: 'DescribePipelineSchemaResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },

  // ── nf-tower/workflow/ ───────────────────────────────────────────────────────

  'PUT /nf-tower/workflow/cancel-workflow-execution/{id}': {
    response: 'CancelWorkflowResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'POST /nf-tower/workflow/create-workflow-execution': {
    response: 'CreateWorkflowLaunchResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
      { name: 'pipelineId', required: false, description: 'Pipeline to launch' },
    ],
  },
  'GET /nf-tower/workflow/list-workflows': {
    response: 'ListWorkflowsResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/workflow/read-workflow/{id}': {
    response: 'DescribeWorkflowResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/workflow/read-workflow-metrics/{id}': {
    response: 'DescribeWorkflowMetricsResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/workflow/read-workflow-progress/{id}': {
    response: 'WorkflowProgressResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
  'GET /nf-tower/workflow/read-workflow-reports/{id}': {
    response: 'DescribeWorkflowReportsResponse',
    query: [
      { name: 'laboratoryId', required: false, description: 'Laboratory to retrieve WorkspaceId and AccessToken' },
    ],
  },
};
