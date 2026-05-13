import { FileDownloadResponseSchema } from '@easy-genomics/shared-lib/src/app/schema/nf-tower/file/request-file-download';
import { FileDownloadResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/file/request-file-download';
import {
  CreateWorkflowLaunchRequest,
  ListWorkflowsResponse,
  DescribeWorkflowResponse,
  Workflow,
} from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
import HttpFactory from '@FE/repository/factory';
import { validateApiResponse } from '@FE/utils/api-utils';

class SeqeraRunsModule extends HttpFactory {
  async createPipelineRun(
    labId: string,
    pipelineId: string,
    pipelineLaunchRequest: CreateWorkflowLaunchRequest,
  ): Promise<any> {
    const res = await this.callSeqera<any>(
      'POST',
      `/workflow/create-workflow-execution?laboratoryId=${labId}&pipelineId=${encodeURIComponent(pipelineId)}`,
      pipelineLaunchRequest,
    );
    console.log('createPipelineRun response:', res);
    if (!res) {
      console.error('Error calling create pipeline run API');
      throw new Error('Failed to create pipeline run');
    }
    return res;
  }

  async list(labId: string): Promise<Workflow[]> {
    const res = await this.callSeqera<ListWorkflowsResponse>('GET', `/workflow/list-workflows?laboratoryId=${labId}`);
    if (!res) {
      throw new Error('Failed to retrieve workflows');
    }

    // wfMeta.workflow is a WorkflowDbDto object, but we want a Workflow
    // their schemas are not idential but they are close, so for now we're coercing them and hoping for the best
    const workflows = res.workflows?.map((wfMeta) => wfMeta.workflow as Workflow);

    return workflows || [];
  }

  async cancelPipelineRun(labId: string, seqeraRunId: string): Promise<any> {
    const res = await this.callSeqera<any>(
      'PUT',
      `/workflow/cancel-workflow-execution/${seqeraRunId}?laboratoryId=${labId}`,
    );

    if (!res) {
      console.error('Error calling cancel pipeline run API');
      throw new Error('Failed to cancel pipeline run');
    }
    return res;
  }

  async readWorkflowReports(workspaceId: string, labId: string): Promise<any> {
    const res = await this.callSeqera<any>(
      'GET',
      `/workflow/read-workflow-reports/${workspaceId}?laboratoryId=${labId}`,
    );
    if (!res) {
      console.error('Error calling read workflow reports API');
      throw new Error('Failed to read workflow reports');
    }
    return res;
  }

  /**
   * Calls '/nf-tower/file/request-file-download' API to download the contents of a specified Seqera Run results file.
   *
   * @param labId
   * @param contentUri
   */
  async downloadSeqeraFile(labId: string, contentUri: string): Promise<FileDownloadResponse> {
    const res: FileDownloadResponse | undefined = await this.callSeqera<FileDownloadResponse>(
      'POST',
      '/file/request-file-download',
      {
        LaboratoryId: labId,
        ContentUri: contentUri,
      },
    );

    if (!res) {
      console.error('Error calling file download API');
      throw new Error('Failed to perform file download');
    }

    validateApiResponse(FileDownloadResponseSchema, res);
    return res;
  }

  async get(labId: string, seqeraRunId: string): Promise<Workflow> {
    const res = await this.callSeqera<DescribeWorkflowResponse>(
      'GET',
      `/workflow/read-workflow/${seqeraRunId}?laboratoryId=${labId}`,
    );

    if (!res) {
      console.error('Error calling get pipeline run API');
      throw new Error('Failed to get pipeline run');
    }

    // as noted in list(...), coercing to get the right type back
    return res.workflow as Workflow;
  }
}

export default SeqeraRunsModule;
