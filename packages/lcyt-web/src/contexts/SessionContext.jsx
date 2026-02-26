import { createContext, useContext } from 'react';
import { useSession } from '../hooks/useSession';

export const SessionContext = createContext(null);

/**
 * Provides session state and methods to the subtree.
 * Accepts all useSession callback options as props for external project integration:
 *   onConnected, onDisconnected, onCaptionSent, onCaptionResult, onCaptionError,
 *   onSyncUpdated, onError
 */
export function SessionProvider({ children, ...opts }) {
  const session = useSession(opts);
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within a SessionProvider');
  return ctx;
}
