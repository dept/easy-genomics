import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';

export type FavouriteWorkflowPlatform = FavouriteWorkflow['Platform'];

/**
 * What is known about a laboratory's live workflow list on one platform.
 *
 * `loaded` is the only state in which a missing id proves the workflow is gone (deleted on
 * the platform, or its access revoked for the lab). The other states mean "cannot tell", so
 * favourites are never deleted on their basis.
 */
export type PlatformWorkflowAvailability =
  | { state: 'loaded'; workflowIds: Set<string> }
  | { state: 'unknown' }
  | { state: 'disabled' };

export type LabWorkflowAvailability = Record<FavouriteWorkflowPlatform, PlatformWorkflowAvailability>;

export type FavouriteWorkflowState = 'available' | 'missing' | 'unknown' | 'platform-disabled';

export function getFavouriteWorkflowState(
  favourite: FavouriteWorkflow,
  availability: LabWorkflowAvailability,
): FavouriteWorkflowState {
  const platform = availability[favourite.Platform];

  switch (platform?.state) {
    case 'loaded':
      return platform.workflowIds.has(favourite.WorkflowId) ? 'available' : 'missing';
    case 'disabled':
      return 'platform-disabled';
    default:
      return 'unknown';
  }
}

/**
 * The lab's favourites worth showing: everything except entries whose workflow is confirmed
 * gone, or whose platform the lab no longer has enabled (they cannot be launched either way).
 */
export function selectVisibleFavouriteWorkflows(
  favourites: FavouriteWorkflow[],
  laboratoryId: string,
  availability: LabWorkflowAvailability,
): FavouriteWorkflow[] {
  return favourites.filter((favourite) => {
    if (favourite.LaboratoryId !== laboratoryId) return false;
    const state = getFavouriteWorkflowState(favourite, availability);
    return state === 'available' || state === 'unknown';
  });
}

/**
 * Splits the user's favourites into the ones to keep and the ones to forget, dropping only
 * this lab's entries whose workflow is confirmed gone. `retained` still holds every other
 * entry — including favourites for other laboratories — so it can be saved as the user's
 * complete favourites list.
 */
export function pruneMissingFavouriteWorkflows(
  favourites: FavouriteWorkflow[],
  laboratoryId: string,
  availability: LabWorkflowAvailability,
): { retained: FavouriteWorkflow[]; removed: FavouriteWorkflow[] } {
  const removed: FavouriteWorkflow[] = [];
  const retained: FavouriteWorkflow[] = [];

  for (const favourite of favourites) {
    const isMissing =
      favourite.LaboratoryId === laboratoryId && getFavouriteWorkflowState(favourite, availability) === 'missing';
    (isMissing ? removed : retained).push(favourite);
  }

  return { retained, removed };
}
