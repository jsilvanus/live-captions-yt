import { createContext, useContext } from 'react';
import { useSentLog } from '../hooks/useSentLog';

export const SentLogContext = createContext(null);

export function SentLogProvider({ children }) {
  const sentLog = useSentLog();
  return (
    <SentLogContext.Provider value={sentLog}>
      {children}
    </SentLogContext.Provider>
  );
}

export function useSentLogContext() {
  const ctx = useContext(SentLogContext);
  if (!ctx) throw new Error('useSentLogContext must be used within a SentLogProvider');
  return ctx;
}
