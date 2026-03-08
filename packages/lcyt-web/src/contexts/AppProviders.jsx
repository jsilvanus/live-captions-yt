import { useEffect, useRef } from 'react';
import { useSentLog } from '../hooks/useSentLog';
import { SessionContext } from './SessionContext';
import { useSession } from '../hooks/useSession';
import { FileProvider } from './FileContext';
import { SentLogContext } from './SentLogContext';
import { ToastProvider } from './ToastContext';
import { LangProvider } from './LangContext';

const EMBED_CHANNEL = 'lcyt-embed';

/**
 * Composes all context providers with proper wiring:
 * - SentLog.confirm and SentLog.markError are wired into SessionProvider as callbacks
 *   so SSE caption results automatically update the delivery log.
 *
 * For external project use, import SessionProvider, FileProvider, etc. individually
 * and wire callbacks yourself.
 *
 * Additional props for embed / site-integration use:
 *   initConfig   { backendUrl, apiKey, streamKey? } — pre-populate credentials (overrides localStorage)
 *   autoConnect  boolean — call connect() on mount when initConfig has valid credentials
 *   embed        boolean — enable BroadcastChannel broadcasting so a sibling EmbedSentLogPage
 *                          (same origin) can receive the JWT token and caption texts without
 *                          sharing the session object.
 */
export function AppProviders({ children, initConfig, autoConnect, embed }) {
  const channelRef      = useRef(null);
  const sessionTokenRef = useRef(null);
  const sessionUrlRef   = useRef(null);

  // Open a BroadcastChannel when running as an embed widget so that sibling
  // EmbedSentLogPage iframes (same origin) can subscribe to the session.
  useEffect(() => {
    if (!embed) return;
    const ch = new BroadcastChannel(EMBED_CHANNEL);
    channelRef.current = ch;

    // Respond to late-joining SentLog widgets that missed the initial broadcast.
    ch.onmessage = (ev) => {
      if (ev.data?.type === 'lcyt:request_session') {
        const token = sessionTokenRef.current;
        const url   = sessionUrlRef.current;
        if (token && url) {
          ch.postMessage({ type: 'lcyt:session', token, backendUrl: url });
        }
      }
    };

    return () => { ch.close(); channelRef.current = null; };
  }, [embed]);

  const sentLog = useSentLog();
  const session = useSession({
    onCaptionResult: sentLog.confirm,
    onCaptionError:  sentLog.markError,
    onCaptionSent: embed
      ? (data) => {
          sentLog.add(data);
          channelRef.current?.postMessage({
            type:      'lcyt:caption',
            requestId: data.requestId,
            text:      data.text,
            timestamp: new Date().toISOString(),
          });
        }
      : sentLog.add,
    onBatchSent: ({ tempIds, requestId }) => {
      tempIds.forEach(id => sentLog.updateRequestId(id, requestId));
    },
    onConnected: embed
      ? (data) => {
          sessionTokenRef.current = data.token;
          sessionUrlRef.current   = data.backendUrl;
          channelRef.current?.postMessage({
            type:       'lcyt:session',
            token:      data.token,
            backendUrl: data.backendUrl,
          });
        }
      : undefined,
    onDisconnected: embed
      ? () => {
          sessionTokenRef.current = null;
          sessionUrlRef.current   = null;
        }
      : undefined,
  });

  // Auto-connect on mount when credentials are provided via URL params.
  // The empty dep array is intentional — initConfig comes from URL params
  // and will not change after the component mounts.
  useEffect(() => {
    if (autoConnect && initConfig?.backendUrl && initConfig?.apiKey) {
      session.connect(initConfig).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LangProvider>
      <SentLogContext.Provider value={sentLog}>
        <SessionContext.Provider value={session}>
          <FileProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </FileProvider>
        </SessionContext.Provider>
      </SentLogContext.Provider>
    </LangProvider>
  );
}
