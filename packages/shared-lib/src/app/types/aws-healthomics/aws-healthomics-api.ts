import {
  CreateWorkflowRequest as AwsCreateWorkflowRequest,
  CreateWorkflowResponse as AwsCreateWorkflowResponse,
  GetRunResponse,
  GetWorkflowResponse,
  ListWorkflowsResponse,
  ListRunsResponse,
  StartRunResponse,
  StartRunRequest,
} from '@aws-sdk/client-omics';

export type CreateRun = StartRunResponse;

export type CreateRunRequest = StartRunRequest;

export type CreateWorkflow = AwsCreateWorkflowResponse;

export type CreateWorkflowRequest = AwsCreateWorkflowRequest;

export type ListWorkflows = ListWorkflowsResponse;

export type ReadWorkflow = GetWorkflowResponse;

export type ListRuns = ListRunsResponse;

export type ReadRun = GetRunResponse;
