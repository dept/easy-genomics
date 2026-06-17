/**
 * These are the types for the workflow report endpoint which is not published as part
 * of the nextflow tower openapi.
 */

export interface WorkflowReport {
  display: string;
  mimeType: string;
  path: string;
  externalPath: string;
  size: number;
}

export interface DescribeWorkflowReportsResponse {
  hasReports: boolean;
  basePath: string;
  reports: WorkflowReport[];
}
