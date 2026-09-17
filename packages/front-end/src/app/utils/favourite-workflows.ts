import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';

export type FavouriteWorkflowPlatform = FavouriteWorkflow['Platform'];

/**
 * What is known about a laboratory's live workflow list on one platform.
 *
 * `loaded` means both halves of the list (private + shared for Omics; the full pipeline
 * list for Seqera) resolved. An id absent from that list is hidden in the UI, but is not
 * treated as proof of deletion: the same list is also filtered by laboratory workflow
 * access, and a missing shared-workflow fetch must not be read as "every shared favourite
 * is gone".
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
 * The lab's favourites worth showing: everything except entries whose workflow is not in
 * the live list, or whose platform the lab no longer has enabled. Hidden entries stay on
 * the user record so a later access grant or platform re-enable can restore them.
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
