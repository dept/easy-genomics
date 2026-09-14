import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { defineStore } from 'pinia';
import { type LabWorkflowAvailability, pruneMissingFavouriteWorkflows } from '@FE/utils/favourite-workflows';

/**
 * The signed-in user's favourite workflows, across every laboratory.
 *
 * Favourites live on the User record, so they are stored and saved as one whole array: every
 * write here sends the complete list. Nothing is persisted client-side because the workflows
 * behind these entries can be deleted on the platform at any time, and a cached favourite
 * would keep offering a workflow that no longer exists.
 */
interface FavouriteWorkflowsStoreState {
  favouriteWorkflows: FavouriteWorkflow[];
}

const initialState = (): FavouriteWorkflowsStoreState => ({
  favouriteWorkflows: [],
});

/** Coalesces concurrent loads (EGLabView and the EGDashboard tab it renders both ask). */
let loadInflight: Promise<void> | null = null;

const useFavouriteWorkflowsStore = defineStore('favouriteWorkflowsStore', {
  state: initialState,

  getters: {
    isFavourited:
      (state: FavouriteWorkflowsStoreState) =>
      (laboratoryId: string, workflowId: string): boolean =>
        state.favouriteWorkflows.some(
          (favourite) => favourite.LaboratoryId === laboratoryId && favourite.WorkflowId === workflowId,
        ),
  },

  actions: {
    reset() {
      loadInflight = null;
      Object.assign(this, initialState());
    },

    async load(): Promise<void> {
      if (loadInflight) {
        return loadInflight;
      }

      const loadPromise = (async () => {
        const { $api } = useNuxtApp();
        try {
          const user = await $api.users.getUser();
          this.favouriteWorkflows = user.FavouriteWorkflows ?? [];
        } catch (error) {
          console.error('Error loading favorite workflows', error);
        }
      })().finally(() => {
        loadInflight = null;
      });

      loadInflight = loadPromise;
      return loadPromise;
    },

    /** Adds the favourite, or removes the existing entry for the same lab and workflow. */
    async toggleFavourite(favourite: FavouriteWorkflow): Promise<void> {
      const isFavourited = this.isFavourited(favourite.LaboratoryId, favourite.WorkflowId);
      const updated = isFavourited
        ? this.favouriteWorkflows.filter(
            (existing) =>
              !(existing.LaboratoryId === favourite.LaboratoryId && existing.WorkflowId === favourite.WorkflowId),
          )
        : [...this.favouriteWorkflows, favourite];

      try {
        await this.save(updated);
        useToastStore().success(isFavourited ? 'Workflow removed from favorites' : 'Workflow added to favorites');
      } catch (error) {
        console.error('Failed to update favorite workflows', error);
        useToastStore().error(
          isFavourited ? 'Failed to remove workflow from favorites' : 'Failed to add workflow to favorites',
        );
      }
    },

    /**
     * Forgets this lab's favourites whose workflow is gone from the platform's live list, so a
     * deleted workflow stops being offered instead of sitting in the list forever. Silent by
     * design: the caller already hides these entries, and a failed write is retried on the next
     * load, so there is nothing for the user to act on.
     *
     * Returns the entries that were removed.
     */
    async pruneMissingForLab(
      laboratoryId: string,
      availability: LabWorkflowAvailability,
    ): Promise<FavouriteWorkflow[]> {
      const { retained, removed } = pruneMissingFavouriteWorkflows(this.favouriteWorkflows, laboratoryId, availability);
      if (removed.length === 0) {
        return [];
      }

      try {
        await this.save(retained);
      } catch (error) {
        console.error('Failed to remove deleted workflows from favorites', error);
        return [];
      }

      return removed;
    },

    /** Writes the user's complete favourites list; local state only changes once the write lands. */
    async save(favouriteWorkflows: FavouriteWorkflow[]): Promise<void> {
      const { $api } = useNuxtApp();
      const userId = useUserStore().currentUserDetails.id;
      if (!userId) {
        throw new Error('cannot save favorite workflows without a signed-in user');
      }

      await $api.users.updateUser(userId, { FavouriteWorkflows: favouriteWorkflows });
      this.favouriteWorkflows = favouriteWorkflows;
    },
  },
});

export default useFavouriteWorkflowsStore;
