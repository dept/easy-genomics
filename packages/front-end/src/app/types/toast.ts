export type ToastVariant = 'success' | 'error' | 'warning' | 'info';
export type Toast = {
  id: string;
  title: string;
  variant: 'success' | 'error' | 'warning' | 'info';
  timeout?: number; // milliseconds; omit to use the component default (3000)
};
