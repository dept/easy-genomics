/**
 * Lab–workflow grants stored in laboratory-workflow-access-table.
 * Partition key: LaboratoryId; sort key: WorkflowKey = `${Platform}#${WorkflowId}`.
 *
 * Semantics depend on Laboratory.EnableNewWorkflowsByDefault:
 * - false (strict): only ALLOW rows grant access; missing/legacy row = ALLOW.
 * - true: DENY rows block access; no row = implicit allow (incl. new console workflows).
 */
export const LABORATORY_WORKFLOW_ACCESS_PLATFORMS = ['HEALTH_OMICS', 'SEQERA'] as const;
export type LaboratoryWorkflowAccessPlatform = (typeof LABORATORY_WORKFLOW_ACCESS_PLATFORMS)[number];

export const LABORATORY_WORKFLOW_ACCESS_EFFECTS = ['ALLOW', 'DENY'] as const;
export type LaboratoryWorkflowAccessEffect = (typeof LABORATORY_WORKFLOW_ACCESS_EFFECTS)[number];

export interface LaboratoryWorkflowAccess {
  LaboratoryId: string;
  /** Format: HEALTH_OMICS#<omicsWorkflowId> or SEQERA#<pipelineId> */
  WorkflowKey: string;
  OrganizationId: string;
  /** ALLOW or DENY; omitted/undefined on legacy rows means ALLOW. */
  Effect?: LaboratoryWorkflowAccessEffect;
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
