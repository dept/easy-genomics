export function canDeletePrivateOmicsWorkflow(params: {
  workflow: {
    id?: string;
    source?: 'PRIVATE' | 'SHARED';
    tags?: Record<string, string>;
  };
  isOrgAdmin: boolean;
}): boolean {
  if (!params.isOrgAdmin || params.workflow.source === 'SHARED' || !params.workflow.id) {
    return false;
  }
  // Fail closed when list tags show the workflow was not created via Easy Genomics.
  const application = params.workflow.tags?.Application;
  if (application && application !== 'easy-genomics') {
    return false;
  }
  return true;
}
