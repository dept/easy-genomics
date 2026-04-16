import type {
  CreateRun,
  ListRuns,
  ReadRun,
} from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
import HttpFactory from '@FE/repository/factory';

class OmicsRunsModule extends HttpFactory {
  async list(labId: string): Promise<ListRuns> {
    const res = await this.callOmics<ListRuns>('GET', `/run/list-runs?laboratoryId=${labId}`);

    if (!res) {
      throw new Error('Failed to retrieve omics runs details');
    }

    return res;
  }

  async get(labId: string, omicsRunId: string): Promise<ReadRun> {
    const res = await this.callOmics<ReadRun>('GET', `/run/read-run/${omicsRunId}?laboratoryId=${labId}`);

    if (!res) {
      throw new Error('Failed to retrieve omics run details');
    }

    return res;
  }

  async createExecution(
    labId: string,
    workflowId: string,
    name: string,
    params: object,
    workflowVersionName?: string,
  ): Promise<CreateRun> {
    const payload: Record<string, string> = {
      workflowId,
      name,
      parameters: JSON.stringify(params),
    };
    if (workflowVersionName) {
      payload.workflowVersionName = workflowVersionName;
    }
    const res = await this.callOmics<CreateRun>('POST', `/run/create-run-execution?laboratoryId=${labId}`, payload);

    if (!res) {
      throw new Error('Failed to start omics run');
    }

    return res;
  }

  async cancelWorkflowRun(labId: string, runId: string): Promise<Record<string, never>> {
    const res = await this.callOmics<Record<string, never>>(
      'PUT',
      `/run/cancel-run-execution/${runId}?laboratoryId=${labId}`,
    );

    if (!res) throw new Error('Failed to cancel omics run');

    return res;
  }
}

export default OmicsRunsModule;
