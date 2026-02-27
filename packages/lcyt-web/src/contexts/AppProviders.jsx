import { useSentLog } from '../hooks/useSentLog';
import { SessionContext } from './SessionContext';
import { useSession } from '../hooks/useSession';
import { FileProvider } from './FileContext';
import { SentLogContext } from './SentLogContext';
import { ToastProvider } from './ToastContext';

/**
 * Composes all context providers with proper wiring:
 * - SentLog.confirm and SentLog.markError are wired into SessionProvider as callbacks
 *   so SSE caption results automatically update the delivery log.
 *
 * For external project use, import SessionProvider, FileProvider, etc. individually
 * and wire callbacks yourself.
 */
export function AppProviders({ children }) {
  // Call useSentLog directly so we can pass its methods to SessionProvider as callbacks
  const sentLog = useSentLog();
  const session = useSession({
    onCaptionResult: sentLog.confirm,
    onCaptionError: sentLog.markError,
    onCaptionSent: sentLog.add,
    onBatchSent: ({ tempIds, requestId }) => {
      tempIds.forEach(id => sentLog.updateRequestId(id, requestId));
    }
  });

  return (
    <SentLogContext.Provider value={sentLog}>
      <SessionContext.Provider value={session}>
        <FileProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </FileProvider>
      </SessionContext.Provider>
    </SentLogContext.Provider>
  );
}
