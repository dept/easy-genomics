import { defineStore } from 'pinia';

type PendingRequest =
  | 'signIn'
  | 'forgotPassword'
  | 'resetPassword'
  | 'sendInvite'
  | 'acceptInvite'
  | 'removeUserFromLab'
  | 'assignLabRole'
  | 'getLabUsers'
  | 'addUserToLab'
  | 'addUsersToLab'
  | 'updateUser'
  | 'getSeqeraPipelines'
  | 'getSeqeraRuns'
  | 'loadSeqeraPipeline'
  | 'loadSeqeraRun'
  | 'cancelSeqeraRun'
  | 'getOmicsWorkflows'
  | 'getOmicsRuns'
  | 'loadOmicsWorkflow'
  | 'loadOmicsRun'
  | 'cancelOmicsRun'
  | 'createOrg'
  | 'fetchOrgData'
  | 'editOrg'
  | 'createLab'
  | 'updateLab'
  | 'applyRunRetentionPolicy'
  | 'getLabs'
  | 'deleteLab'
  | 'fetchOrgLabs'
  | 'fetchUserLabs'
  | 'loadLabData'
  | `addUserToLabButton-${string}-${string}`
  | 'fetchS3Content'
  | 'loadRunReports'
  | 'editProfileDetails'
  | 'toggleOrgAdmin'
  | 'loadLabRuns'
  | 'updateDefaultOrg'
  | 'generateSampleSheet'
  | 'downloadSampleSheet'
  | `downloadHtmlFileButton-${string}`
  | 'switchOrg';

interface UiStoreState {
  pendingRequests: Set<string>;
  previousPageRoute: string;
  remountAppKey: number;
}

const initialState = (): UiStoreState => ({
  pendingRequests: new Set<string>(),
  previousPageRoute: '',
  remountAppKey: 0,
});

const useUiStore = defineStore('uiStore', {
  state: initialState,

  getters: {
    isRequestPending:
      (state: UiStoreState) =>
      (val: PendingRequest): boolean =>
        state.pendingRequests.has(val),

    anyRequestPending:
      (state: UiStoreState) =>
      (vals: PendingRequest[]): boolean =>
        vals.some((val) => state.pendingRequests.has(val)),
  },

  actions: {
    reset() {
      Object.assign(this, initialState());
    },

    setRequestPending(val: PendingRequest): void {
      this.pendingRequests.add(val);
    },
    setRequestComplete(val: PendingRequest): void {
      this.pendingRequests.delete(val);
    },

    setPreviousPageRoute(route: string) {
      this.previousPageRoute = route;
    },

    incrementRemountAppKey() {
      this.remountAppKey++;
    },
  },

  persist: {
    pick: ['previousPageRoute'],
  },
});

export default useUiStore;
