import { createContext, useContext } from 'react';

/**
 * CaptionContext — provides caption-sending state and methods.
 *
 * Split from SessionContext so that components that only deal with sending
 * (sequence counter, sync offset) re-render independently of connection state.
 *
 * Slice: sequence, syncOffset,
 *        send, sendBatch, construct, flushBatch, sync, heartbeat,
 *        updateSequence, updateTargets, getQueuedCount
 */
export const CaptionContext = createContext(null);

export function useCaptionContext() {
  const ctx = useContext(CaptionContext);
  if (!ctx) throw new Error('useCaptionContext must be used within AppProviders');
  return ctx;
}
