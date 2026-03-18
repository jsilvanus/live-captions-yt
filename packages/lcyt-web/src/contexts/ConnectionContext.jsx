import { createContext, useContext } from 'react';

/**
 * ConnectionContext — provides connection state and connect/disconnect methods.
 *
 * Split from SessionContext to prevent caption-send re-renders (sequence updates)
 * from triggering UI components that only care about connection status.
 *
 * Slice: connected, backendUrl, apiKey, streamKey, startedAt, micHolder, clientId,
 *        graphicsEnabled, healthStatus, latencyMs, reconnecting,
 *        connect, disconnect, reconnectNow, checkHealth, claimMic, releaseMic,
 *        getPersistedConfig, getAutoConnect, setAutoConnect, clearPersistedConfig
 */
export const ConnectionContext = createContext(null);

export function useConnectionContext() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnectionContext must be used within AppProviders');
  return ctx;
}
