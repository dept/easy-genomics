export const PRIVATE_WORKFLOW_DELETE_DENIED_MESSAGE =
  'You can only delete private workflows created in this laboratory through Easy Genomics.';

/**
 * Org/system admins (already authorised by the delete handler) may delete any
 * Easy Genomics private workflow tagged to the laboratory — not only their own.
 */
export function canDeleteOwnedPrivateWorkflow(params: {
  tags: Record<string, string> | undefined;
  laboratoryId: string;
  organizationId: string;
}): boolean {
  const tags = params.tags ?? {};
  return (
    tags.Application === 'easy-genomics' &&
    tags.LaboratoryId === params.laboratoryId &&
    tags.OrganizationId === params.organizationId
  );
}
