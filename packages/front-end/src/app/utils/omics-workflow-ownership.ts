export function canDeletePrivateOmicsWorkflow(params: {
  workflow: {
    id?: string;
    source?: 'PRIVATE' | 'SHARED';
    tags?: Record<string, string>;
  };
  canCreateOmicsWorkflows: boolean;
  userIds: Array<string | null | undefined>;
}): boolean {
  if (!params.canCreateOmicsWorkflows || params.workflow.source === 'SHARED' || !params.workflow.id) {
    return false;
  }
  const createdBy = params.workflow.tags?.UserId;
  if (!createdBy) {
    return false;
  }
  return params.userIds.some((id) => Boolean(id) && id === createdBy);
}
