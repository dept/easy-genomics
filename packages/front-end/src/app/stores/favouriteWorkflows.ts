import { FavouriteWorkflow } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { defineStore } from 'pinia';

/**
 * The signed-in user's favourite workflows, across every laboratory.
 *
 * Favourites live on the User record, so they are stored and saved as one whole array: every
 * write here sends the complete list. Nothing is persisted client-side because the workflows
 * behind these entries can be deleted on the platform at any time, and a cached favourite
 * would keep offering a workflow that no longer exists.
 *
 * `loaded` must be true before any write. The back-end replaces the whole array with no
 * merge, so a star click against an empty in-memory snapshot would destroy every laboratory's
 * favourites.
 */
interface FavouriteWorkflowsStoreState {
  favouriteWorkflows: FavouriteWorkflow[];
  loaded: boolean;
}

const initialState = (): FavouriteWorkflowsStoreState => ({
  favouriteWorkflows: [],
  loaded: false,
});

/** Coalesces concurrent loads (EGLabView and the EGDashboard tab it renders both ask). */
let loadInflight: Promise<void> | null = null;
/** Bumped on reset so a getUser() that outlives logout cannot write the previous user's list. */
let loadGeneration = 0;

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
      loadGeneration += 1;
      loadInflight = null;
      Object.assign(this, initialState());
    },

    async load(): Promise<void> {
      if (loadInflight) {
        return loadInflight;
      }

      const generation = loadGeneration;
      const loadPromise = (async () => {
        const { $api } = useNuxtApp();
        try {
          const user = await $api.users.getUser();
          if (generation !== loadGeneration) {
            return;
          }
          this.favouriteWorkflows = user.FavouriteWorkflows ?? [];
          this.loaded = true;
        } catch (error) {
          if (generation !== loadGeneration) {
            return;
          }
          console.error('Error loading favorite workflows', error);
          if (!this.loaded) {
            useToastStore().error('Failed to load favorite workflows. Please refresh.');
          }
        }
      })().finally(() => {
        if (loadInflight === loadPromise) {
          loadInflight = null;
        }
      });

      loadInflight = loadPromise;
      return loadPromise;
    },

    /** Adds the favourite, or removes the existing entry for the same lab and workflow. */
    async toggleFavourite(favourite: FavouriteWorkflow): Promise<void> {
      const wasFavourited = this.isFavourited(favourite.LaboratoryId, favourite.WorkflowId);

      try {
        // Re-read immediately before the whole-array write so a favourite added in another
        // tab is not overwritten by this session's older snapshot.
        await this.load();
        if (!this.loaded) {
          // load() already toasted when it had nothing to show.
          return;
        }

        const isFavourited = this.isFavourited(favourite.LaboratoryId, favourite.WorkflowId);
        const updated = isFavourited
          ? this.favouriteWorkflows.filter(
              (existing) =>
                !(existing.LaboratoryId === favourite.LaboratoryId && existing.WorkflowId === favourite.WorkflowId),
            )
          : [...this.favouriteWorkflows, favourite];

        await this.save(updated);
        useToastStore().success(isFavourited ? 'Workflow removed from favorites' : 'Workflow added to favorites');
      } catch (error) {
        console.error('Failed to update favorite workflows', error);
        useToastStore().error(
          wasFavourited ? 'Failed to remove workflow from favorites' : 'Failed to add workflow to favorites',
        );
      }
    },

    /** Writes the user's complete favourites list; local state only changes once the write lands. */
    async save(favouriteWorkflows: FavouriteWorkflow[]): Promise<void> {
      if (!this.loaded) {
        throw new Error('cannot save favorite workflows before they have been loaded');
      }

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
