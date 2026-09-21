const OWNERSHIP_DENIED_MESSAGE = 'You can only delete private workflows that you created in this laboratory.';

type AuthorizerClaims = Record<string, unknown> | undefined;

/**
 * IDs that may have been stored on a HealthOmics UserId tag at create time.
 * create-private-workflow uses `sub ?? cognito:username`; the custom UserId claim is
 * included so seeded accounts still match.
 */
export function creatorIdsFromAuthorizerClaims(claims: AuthorizerClaims): Set<string> {
  const values = [claims?.sub, claims?.['cognito:username'], claims?.UserId];
  return new Set(
    values
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim()),
  );
}

export function canDeleteOwnedPrivateWorkflow(params: {
  tags: Record<string, string> | undefined;
  laboratoryId: string;
  organizationId: string;
  creatorIds: Set<string>;
}): { allowed: true } | { allowed: false; reason: string } {
  const tags = params.tags ?? {};
  const createdByApp = tags.Application === 'easy-genomics';
  const belongsToLab = tags.LaboratoryId === params.laboratoryId && tags.OrganizationId === params.organizationId;
  const ownedByCaller = Boolean(tags.UserId) && params.creatorIds.has(tags.UserId);

  if (!createdByApp || !belongsToLab || !ownedByCaller) {
    return { allowed: false, reason: OWNERSHIP_DENIED_MESSAGE };
  }

  return { allowed: true };
}
