import { createContext, useContext } from 'react';
import { useToast } from '../hooks/useToast';

export const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const toast = useToast();
  return (
    <ToastContext.Provider value={toast}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastContext must be used within a ToastProvider');
  return ctx;
}
