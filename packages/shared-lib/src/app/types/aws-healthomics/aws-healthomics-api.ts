import {
  CreateWorkflowRequest as AwsCreateWorkflowRequest,
  CreateWorkflowResponse as AwsCreateWorkflowResponse,
  GetRunResponse,
  GetWorkflowResponse,
  ListWorkflowsResponse,
  ListRunsResponse,
  StartRunResponse,
  StartRunRequest,
  TaskListItem,
} from '@aws-sdk/client-omics';

export type CreateRun = StartRunResponse;

export type CreateRunRequest = StartRunRequest;

export type CreateWorkflow = AwsCreateWorkflowResponse;

export type CreateWorkflowRequest = AwsCreateWorkflowRequest;

export type ListWorkflows = ListWorkflowsResponse;

export type ReadWorkflow = GetWorkflowResponse;

export type ListRuns = ListRunsResponse;

export type ReadRun = GetRunResponse;

/** Aggregated task progress derived from HealthOmics ListRunTasks. */
export type RunTaskProgress = {
  tasksTotal: number;
  tasksCompleted: number;
  tasksRunning: number;
  tasksFailed: number;
  percent: number;
};

/** Response for GET /aws-healthomics/run/read-run-tasks/{id}. */
export type ReadRunTasks = {
  progress: RunTaskProgress;
  tasks: TaskListItem[];
};
