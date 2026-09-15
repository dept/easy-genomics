import {
  CreateWorkflowRunPreset,
  UpdateWorkflowRunPreset,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-run-preset';
import type {
  ListWorkflowRunPresetsResponse,
  WorkflowRunPreset,
  WorkflowRunPresetScope,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
import HttpFactory from '@FE/repository/factory';

const BASE_PATH = '/workflow-run-preset';

class WorkflowRunPresetsModule extends HttpFactory {
  async list(laboratoryId: string, workflowId: string): Promise<ListWorkflowRunPresetsResponse> {
    const query = new URLSearchParams({ laboratoryId, workflowId });
    const res = await this.call<ListWorkflowRunPresetsResponse>(
      'GET',
      `${BASE_PATH}/list-workflow-run-presets?${query.toString()}`,
    );
    if (!res) throw new Error('Failed to list workflow run presets');
    return res;
  }

  async create(body: CreateWorkflowRunPreset): Promise<WorkflowRunPreset> {
    const res = await this.call<WorkflowRunPreset>('POST', `${BASE_PATH}/create-workflow-run-preset`, body);
    if (!res) throw new Error('Failed to create workflow run preset');
    return res;
  }

  async update(presetId: string, body: UpdateWorkflowRunPreset): Promise<WorkflowRunPreset> {
    const res = await this.call<WorkflowRunPreset>(
      'PUT',
      `${BASE_PATH}/update-workflow-run-preset/${encodeURIComponent(presetId)}`,
      body,
    );
    if (!res) throw new Error('Failed to update workflow run preset');
    return res;
  }

  async delete(
    presetId: string,
    laboratoryId: string,
    workflowId: string,
    scope: WorkflowRunPresetScope,
  ): Promise<void> {
    const query = new URLSearchParams({ laboratoryId, workflowId, scope });
    await this.call(
      'DELETE',
      `${BASE_PATH}/delete-workflow-run-preset/${encodeURIComponent(presetId)}?${query.toString()}`,
    );
  }
}

export default WorkflowRunPresetsModule;
