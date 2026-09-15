import { components, operations } from './nextflow-tower-openapi-spec';

/** GET /workflow **/
export type ListWorkflowsQuery = operations['ListWorkflows']['parameters']['query'];
export type ListWorkflowsResponse = components['schemas']['ListWorkflowsResponse'];

/** GET /workflow/{workflowId}/progress **/
export type WorkflowProgressQuery = operations['DescribeWorkflowProgress']['parameters']['query'];
export type WorkflowProgressResponse = components['schemas']['GetProgressResponse'];
export type ProgressData = components['schemas']['ProgressData'];
export type ProcessLoad = components['schemas']['ProcessLoad'];
export type WorkflowLoad = components['schemas']['WorkflowLoad'];

/** GET /workflow/{workflowId} **/
export type DescribeWorkflowQuery = operations['DescribeWorkflow']['parameters']['query'];
export type DescribeWorkflowResponse = components['schemas']['DescribeWorkflowResponse'];
export type Workflow = components['schemas']['Workflow'];

/** GET /workflow/{workflowId}/metrics **/
export type DescribeWorkflowMetricsQuery = operations['DescribeWorkflowMetrics']['parameters']['query'];
export type DescribeWorkflowMetricsResponse = components['schemas']['GetWorkflowMetricsResponse'];

/** POST /workflow/launch **/
export type CreateWorkflowLaunchQuery = operations['CreateWorkflowLaunch']['parameters']['query'];
export type CreateWorkflowLaunchRequest = components['schemas']['SubmitWorkflowLaunchRequest'];
export type CreateWorkflowLaunchResponse = components['schemas']['SubmitWorkflowLaunchResponse'];

/** POST /workflow/{workflowId}/cancel **/
export type CancelWorkflowQuery = operations['CancelWorkflow']['parameters']['query'];
export type CancelWorkflowResponse = string;

/** GET /compute-envs **/
export type ListComputeEnvsQuery = operations['ListComputeEnvs']['parameters']['query'];
export type ListComputeEnvsResponse = components['schemas']['ListComputeEnvsResponse'];

/** GET /compute-envs/{computeEnvId} **/
export type DescribeComputeEnvsQuery = operations['DescribeComputeEnv']['parameters']['query'];
export type DescribeComputeEnvsResponse = components['schemas']['DescribeComputeEnvResponse'];

/** GET /pipelines **/
export type ListPipelinesQuery = operations['ListPipelines']['parameters']['query'];
export type ListPipelinesResponse = components['schemas']['ListPipelinesResponse'];
export type Pipeline = components['schemas']['PipelineDbDto'];

/** GET /pipelines/{pipelineId} **/
export type DescribePipelinesQuery = operations['DescribePipeline']['parameters']['query'];
export type DescribePipelinesResponse = components['schemas']['DescribePipelineResponse'];

/** GET /pipelines/{pipelineId}/launch **/
export type DescribePipelineLaunchQuery = operations['DescribePipelineLaunch']['parameters']['query'];
export type DescribePipelineLaunchResponse = components['schemas']['DescribeLaunchResponse'];

/** GET /pipelines/{pipelineId}/schema **/
export type DescribePipelineSchemaQuery = operations['DescribePipelineSchema']['parameters']['query'];
export type DescribePipelineSchemaResponse = components['schemas']['PipelineSchemaResponse'];
