import {
  EditWorkflowKeyOutputDelivery,
  EditWorkflowKeyOutputs,
  RequestPreviewWorkflowKeyOutputs,
  RequestRunMicroreactExport,
  RequestRunWorkflowKeyOutputs,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import type {
  ListWorkflowKeyOutputsResponse,
  PreviewWorkflowKeyOutputsResponse,
  RequestRunMicroreactExportResponse,
  RunWorkflowKeyOutputsResponse,
  WorkflowKeyOutputs,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import HttpFactory from '@FE/repository/factory';

const BASE_PATH = '/workflow-key-outputs';

class WorkflowKeyOutputsModule extends HttpFactory {
  async list(laboratoryId: string, workflowId: string): Promise<ListWorkflowKeyOutputsResponse> {
    const query = new URLSearchParams({ laboratoryId, workflowId });
    const res = await this.call<ListWorkflowKeyOutputsResponse>(
      'GET',
      `${BASE_PATH}/list-workflow-key-outputs?${query.toString()}`,
    );
    if (!res) throw new Error('Failed to load key outputs');
    return res;
  }

  async edit(body: EditWorkflowKeyOutputs): Promise<WorkflowKeyOutputs> {
    const res = await this.call<WorkflowKeyOutputs>('POST', `${BASE_PATH}/edit-workflow-key-outputs`, body);
    if (!res) throw new Error('Failed to save key outputs');
    return res;
  }

  async editDelivery(body: EditWorkflowKeyOutputDelivery): Promise<WorkflowKeyOutputs> {
    const res = await this.call<WorkflowKeyOutputs>('POST', `${BASE_PATH}/edit-workflow-key-output-delivery`, body);
    if (!res) throw new Error('Failed to save key output delivery');
    return res;
  }

  async preview(body: RequestPreviewWorkflowKeyOutputs): Promise<PreviewWorkflowKeyOutputsResponse> {
    const res = await this.call<PreviewWorkflowKeyOutputsResponse>(
      'POST',
      `${BASE_PATH}/request-preview-workflow-key-outputs`,
      body,
    );
    if (!res) throw new Error('Failed to preview key outputs');
    return res;
  }

  async runMatches(body: RequestRunWorkflowKeyOutputs): Promise<RunWorkflowKeyOutputsResponse> {
    const res = await this.call<RunWorkflowKeyOutputsResponse>(
      'POST',
      `${BASE_PATH}/request-run-workflow-key-outputs`,
      body,
    );
    if (!res) throw new Error('Failed to load key outputs for this run');
    return res;
  }

  async requestMicroreactExport(body: RequestRunMicroreactExport): Promise<RequestRunMicroreactExportResponse> {
    const res = await this.call<RequestRunMicroreactExportResponse>(
      'POST',
      `${BASE_PATH}/request-run-microreact-export`,
      body,
    );
    if (!res) throw new Error('Failed to send this run to Microreact');
    return res;
  }
}

export default WorkflowKeyOutputsModule;
