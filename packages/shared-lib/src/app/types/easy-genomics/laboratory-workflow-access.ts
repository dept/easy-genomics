/**
 * Lab–workflow allowlist stored in laboratory-workflow-access-table.
 * Partition key: LaboratoryId; sort key: WorkflowKey = `${Platform}#${WorkflowId}`.
 */
export const LABORATORY_WORKFLOW_ACCESS_PLATFORMS = ['HEALTH_OMICS', 'SEQERA'] as const;
export type LaboratoryWorkflowAccessPlatform = (typeof LABORATORY_WORKFLOW_ACCESS_PLATFORMS)[number];

export interface LaboratoryWorkflowAccess {
  LaboratoryId: string;
  /** Format: HEALTH_OMICS#<omicsWorkflowId> or SEQERA#<pipelineId> */
  WorkflowKey: string;
  OrganizationId: string;
  WorkflowName?: string;
  CreatedAt?: string;
  ModifiedAt?: string;
}

/** API / UI catalog row (unified HealthOmics + Seqera). */
export interface UnifiedWorkflowCatalogEntry {
  platform: 'HealthOmics' | 'Seqera';
  workflowId: string;
  name: string;
}

export interface ListLaboratoryWorkflowAccessAssignmentsResponse {
  assignments: LaboratoryWorkflowAccess[];
}

export interface ListUnifiedWorkflowCatalogResponse {
  workflows: UnifiedWorkflowCatalogEntry[];
}

export interface BatchLaboratoryWorkflowAccessAssignment {
  laboratoryId: string;
  platform: LaboratoryWorkflowAccessPlatform;
  workflowId: string;
  workflowName?: string;
  granted: boolean;
}

export interface BatchUpdateLaboratoryWorkflowAccessRequest {
  assignments: BatchLaboratoryWorkflowAccessAssignment[];
}
