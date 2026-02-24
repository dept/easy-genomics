import { defineStore } from 'pinia';
import { v4 as uuidv4 } from 'uuid';

import { Toast } from '@FE/types/toast';

interface ToastStoreState {
  toasts: Toast[];
}

const initialState = (): ToastStoreState => ({
  toasts: [],
});

const useToastStore = defineStore('toastStore', {
  state: initialState,

  actions: {
    remove(id: string) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id);
    },

    info(title: string, timeout?: number) {
      this.toasts.push({ id: `toast-${uuidv4()}`, title, variant: 'info', timeout });
    },
    success(title: string, timeout?: number) {
      this.toasts.push({ id: `toast-${uuidv4()}`, title, variant: 'success', timeout });
    },
    warning(title: string, timeout?: number) {
      this.toasts.push({ id: `toast-${uuidv4()}`, title, variant: 'warning', timeout });
    },
    error(title: string, timeout?: number) {
      this.toasts.push({ id: `toast-${uuidv4()}`, title, variant: 'error', timeout });
    },
  },
});

export default useToastStore;
