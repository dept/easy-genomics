import {
  BatchUpdateLaboratoryWorkflowAccessRequest,
  ListLaboratoryWorkflowAccessAssignmentsResponse,
  ListUnifiedWorkflowCatalogResponse,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import HttpFactory from '@FE/repository/factory';

class WorkflowAccessModule extends HttpFactory {
  async listCatalog(organizationId: string): Promise<ListUnifiedWorkflowCatalogResponse> {
    const res = await this.call<ListUnifiedWorkflowCatalogResponse>(
      'GET',
      `/organization/workflow-access/list-workflow-catalog?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (!res || !Array.isArray(res.workflows)) {
      throw new Error('Failed to load workflow catalog');
    }
    return res;
  }

  async listAssignments(organizationId: string): Promise<ListLaboratoryWorkflowAccessAssignmentsResponse> {
    const res = await this.call<ListLaboratoryWorkflowAccessAssignmentsResponse>(
      'GET',
      `/organization/workflow-access/list-workflow-access-assignments?organizationId=${encodeURIComponent(organizationId)}`,
    );
    if (!res || !Array.isArray(res.assignments)) {
      throw new Error('Failed to load workflow assignments');
    }
    return res;
  }

  async batchUpdate(organizationId: string, body: BatchUpdateLaboratoryWorkflowAccessRequest): Promise<void> {
    const res = await this.call<{ ok?: boolean }>(
      'POST',
      `/organization/workflow-access/edit-workflow-access-batch?organizationId=${encodeURIComponent(organizationId)}`,
      body,
    );
    if (!res?.ok) {
      throw new Error('Failed to save workflow access');
    }
  }
}

export default WorkflowAccessModule;
