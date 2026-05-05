import { CreateWorkflowCommandInput } from '@aws-sdk/client-omics';
import {
  CreateWorkflow,
  ListWorkflows,
  ReadWorkflow,
} from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
import HttpFactory from '@FE/repository/factory';

export type CreateOmicsWorkflowRequest = CreateWorkflowCommandInput & {
  githubRepoUrl?: string;
  githubRef?: string;
};

type ListWorkflowVersionsResponse = {
  items?: Array<{
    versionName?: string;
    status?: string;
    workflowId?: string;
    description?: string;
    creationTime?: Date | string;
  }>;
  nextToken?: string;
};

type CreateWorkflowUploadRequest = {
  fileName: string;
  size: number;
  requestId?: string;
};

type CreateWorkflowUploadResponse = {
  requestId: string;
  bucket: string;
  key: string;
  s3Uri: string;
  uploadUrl: string;
};

class OmicsWorkflowsModule extends HttpFactory {
  async list(labId: string): Promise<ListWorkflows> {
    const res = await this.callOmics<ListWorkflows>('GET', `/workflow/list-private-workflows?laboratoryId=${labId}`);

    if (!res) {
      throw new Error('Failed to retrieve omics workflows details');
    }

    return res;
  }

  async create(labId: string, payload: CreateOmicsWorkflowRequest): Promise<CreateWorkflow> {
    const res = await this.callOmics<CreateWorkflow>(
      'POST',
      `/workflow/create-private-workflow?laboratoryId=${labId}`,
      payload,
    );

    if (!res) {
      throw new Error('Failed to create omics workflow');
    }

    return res;
  }

  async createUploadRequest(
    labId: string,
    payload: CreateWorkflowUploadRequest,
  ): Promise<CreateWorkflowUploadResponse> {
    const res = await this.callOmics<CreateWorkflowUploadResponse>(
      'POST',
      `/workflow/create-workflow-upload-request?laboratoryId=${labId}`,
      payload,
    );

    if (!res) {
      throw new Error('Failed to create workflow upload request');
    }

    return res;
  }

  async get(labId: string, workflowId: string): Promise<ReadWorkflow> {
    const res = await this.callOmics<ReadWorkflow>(
      'GET',
      `/workflow/read-private-workflow/${workflowId}?laboratoryId=${labId}`,
    );

    if (!res) {
      throw new Error('Failed to retrieve omics workflow details');
    }

    return res;
  }

  async listVersions(labId: string, workflowId: string): Promise<ListWorkflowVersionsResponse> {
    const res = await this.callOmics<ListWorkflowVersionsResponse>(
      'GET',
      `/workflow/list-workflow-versions?laboratoryId=${labId}&workflowId=${encodeURIComponent(workflowId)}`,
    );

    if (!res) {
      throw new Error('Failed to retrieve omics workflow versions');
    }

    return res;
  }
}

export default OmicsWorkflowsModule;
