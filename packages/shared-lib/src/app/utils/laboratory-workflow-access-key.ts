import {
  LABORATORY_WORKFLOW_ACCESS_PLATFORMS,
  LaboratoryWorkflowAccessPlatform,
} from '../types/easy-genomics/laboratory-workflow-access';

export function parseWorkflowAccessSortKey(workflowKey: string): {
  platform: LaboratoryWorkflowAccessPlatform;
  workflowId: string;
} | null {
  const idx = workflowKey.indexOf('#');
  if (idx <= 0) {
    return null;
  }
  const platform = workflowKey.slice(0, idx) as LaboratoryWorkflowAccessPlatform;
  if (!LABORATORY_WORKFLOW_ACCESS_PLATFORMS.includes(platform)) {
    return null;
  }
  const workflowId = workflowKey.slice(idx + 1);
  if (!workflowId) {
    return null;
  }
  return { platform, workflowId };
}
