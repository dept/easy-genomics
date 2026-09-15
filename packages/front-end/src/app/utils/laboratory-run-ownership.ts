import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';

/**
 * Whether a laboratory run was initiated by the given user.
 *
 * Matches on UserId (Cognito / platform user id) or Owner email. Owner is the
 * reliable fallback when Cognito username and DynamoDB UserId diverge (e.g.
 * seeded non-prod users with email sign-in aliases).
 */
export function isLaboratoryRunOwnedByUser(
  run: Pick<LaboratoryRun, 'UserId' | 'Owner'>,
  user: { id?: string | null; email?: string | null },
): boolean {
  if (user.id && run.UserId === user.id) {
    return true;
  }
  if (user.email && run.Owner?.toLowerCase() === user.email.toLowerCase()) {
    return true;
  }
  return false;
}
