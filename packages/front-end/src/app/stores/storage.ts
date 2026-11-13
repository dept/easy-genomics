import type {
  LaboratoryStorageSummary,
  OrganizationStorageLab,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { defineStore } from 'pinia';
import { extractApiErrorMessage } from '@FE/utils/api-utils';

interface StorageStoreState {
  // indexed by labId
  labStorage: Record<string, LaboratoryStorageSummary>;
  // indexed by orgId
  orgStorage: Record<string, OrganizationStorageLab[]>;
}

const initialState = (): StorageStoreState => ({
  labStorage: {},
  orgStorage: {},
});

/** Not persisted: snapshots can hold thousands of items and are re-read on every visit. */
const useStorageStore = defineStore('storageStore', {
  state: initialState,

  actions: {
    reset() {
      Object.assign(this, initialState());
    },

    async loadLabStorage(orgId: string, labId: string): Promise<void> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('loadLabStorage');
      try {
        this.labStorage[labId] = await $api.labs.listStorage(orgId, labId);
      } catch (error) {
        console.error('Failed to load lab storage:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to load lab storage. Please refresh.');
      } finally {
        useUiStore().setRequestComplete('loadLabStorage');
      }
    },

    async rescanLabStorage(orgId: string, labId: string): Promise<void> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('rescanLabStorage');
      try {
        this.labStorage[labId] = await $api.labs.rescanStorage(orgId, labId);
        useToastStore().success('Bucket rescanned');
      } catch (error) {
        console.error('Failed to rescan lab storage:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to rescan the bucket. Please try again.');
      } finally {
        useUiStore().setRequestComplete('rescanLabStorage');
      }
    },

    async setLabStorageProtection(orgId: string, labId: string, itemIds: string[], isProtected: boolean) {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('editLabStorage');
      try {
        this.labStorage[labId] = await $api.labs.editStorageProtection(orgId, labId, itemIds, isProtected);
      } catch (error) {
        console.error('Failed to update storage protection:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to update protection. Please try again.');
      } finally {
        useUiStore().setRequestComplete('editLabStorage');
      }
    },

    async removeLabStorageItems(orgId: string, labId: string, itemIds: string[]): Promise<void> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('editLabStorage');
      try {
        const result = await $api.labs.removeStorageItems(orgId, labId, itemIds);
        this.labStorage[labId] = result.Summary;
        const skipped = result.SkippedObjectCount
          ? ` ${result.SkippedObjectCount} file${result.SkippedObjectCount === 1 ? ' was' : 's were'} kept because something still uses ${result.SkippedObjectCount === 1 ? 'it' : 'them'} or ${result.SkippedObjectCount === 1 ? 'it is' : 'they are'} protected.`
          : '';
        useToastStore().success(
          `Deleted ${result.DeletedObjectCount} file${result.DeletedObjectCount === 1 ? '' : 's'}.${skipped}`,
        );
      } catch (error) {
        console.error('Failed to delete stored data:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to delete. Please try again.');
      } finally {
        useUiStore().setRequestComplete('editLabStorage');
      }
    },

    async loadOrgStorage(orgId: string): Promise<void> {
      const { $api } = useNuxtApp();
      useUiStore().setRequestPending('loadOrgStorage');
      try {
        this.orgStorage[orgId] = await $api.labs.listOrgStorage(orgId);
      } catch (error) {
        console.error('Failed to load organization storage:', error);
        useToastStore().error(extractApiErrorMessage(error) ?? 'Failed to load storage. Please refresh.');
      } finally {
        useUiStore().setRequestComplete('loadOrgStorage');
      }
    },
  },
});

export default useStorageStore;
