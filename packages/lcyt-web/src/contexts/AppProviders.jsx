import { useEffect, useRef, useMemo } from 'react';
import { useSentLog } from '../hooks/useSentLog';
import { SessionContext } from './SessionContext';
import { ConnectionContext } from './ConnectionContext';
import { CaptionContext } from './CaptionContext';
import { SessionApiContext } from './SessionApiContext';
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
 * Also provides three focused sub-contexts split from SessionContext:
 *   ConnectionContext  — connected state + connect/disconnect/health
 *   CaptionContext     — sequence/syncOffset + send/sendBatch/sync
 *   SessionApiContext  — stable API methods (stats, files, relay, images)
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

  // Auto-connect on mount:
  //   1. If initConfig + autoConnect prop are provided (embed / URL-param mode), use those.
  //   2. Otherwise, if the user previously enabled "auto-connect", reload the persisted config
  //      so the session survives a page refresh.
  useEffect(() => {
    if (autoConnect && initConfig?.backendUrl && initConfig?.apiKey) {
      session.connect(initConfig).catch(() => {});
    } else if (!autoConnect) {
      const persisted = session.getPersistedConfig();
      if (session.getAutoConnect() && persisted?.backendUrl && persisted?.apiKey) {
        session.connect(persisted).catch(() => {});
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Unsaved work protection (P0 6c) ────────────────────────────────────────
  // Warn before page unload if there is a pending batch queue.
  // (STT active state is checked separately in AppLayout / AudioPage.)
  useEffect(() => {
    function onBeforeUnload(e) {
      const pending = session.getQueuedCount();
      if (pending > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session.getQueuedCount]); // getQueuedCount is stable (useCallback [])

  // ─── Split contexts (P2 7b) ─────────────────────────────────────────────────
  //
  // Each slice is memoized so that changing one type of state (e.g. sequence on
  // every caption send) does not cause re-renders in consumers of the other contexts.
  //
  // All functions in each slice are stable (useCallback in useSession), so they
  // do NOT appear in the useMemo dependency arrays — they never change.
  // Only the state values that may change are listed as deps.

  const connectionValue = useMemo(() => ({
    // State
    connected:       session.connected,
    backendUrl:      session.backendUrl,
    apiKey:          session.apiKey,
    streamKey:       session.streamKey,
    startedAt:       session.startedAt,
    micHolder:       session.micHolder,
    clientId:        session.clientId,
    graphicsEnabled: session.graphicsEnabled,
    healthStatus:    session.healthStatus,
    latencyMs:       session.latencyMs,
    reconnecting:    session.reconnecting,
    // Methods (stable via useCallback)
    connect:              session.connect,
    disconnect:           session.disconnect,
    reconnectNow:         session.reconnectNow,
    checkHealth:          session.checkHealth,
    claimMic:             session.claimMic,
    releaseMic:           session.releaseMic,
    getPersistedConfig:   session.getPersistedConfig,
    getAutoConnect:       session.getAutoConnect,
    setAutoConnect:       session.setAutoConnect,
    clearPersistedConfig: session.clearPersistedConfig,
  }), [ // eslint-disable-line react-hooks/exhaustive-deps
    session.connected, session.backendUrl, session.apiKey, session.streamKey,
    session.startedAt, session.micHolder, session.graphicsEnabled,
    session.healthStatus, session.latencyMs, session.reconnecting,
    // Functions omitted from deps — they are stable (useCallback []) in useSession
  ]);

  const captionValue = useMemo(() => ({
    // State
    sequence:    session.sequence,
    syncOffset:  session.syncOffset,
    // Methods (stable via useCallback)
    send:            session.send,
    sendBatch:       session.sendBatch,
    construct:       session.construct,
    flushBatch:      session.flushBatch,
    sync:            session.sync,
    heartbeat:       session.heartbeat,
    updateSequence:  session.updateSequence,
    updateTargets:   session.updateTargets,
    getQueuedCount:  session.getQueuedCount,
  }), [ // eslint-disable-line react-hooks/exhaustive-deps
    session.sequence, session.syncOffset,
    // Functions omitted — stable via useCallback
  ]);

  // SessionApiContext: all methods are stable, so this object never changes.
  const sessionApiValue = useMemo(() => ({
    getStats:         session.getStats,
    eraseSelf:        session.eraseSelf,
    listFiles:        session.listFiles,
    getFileDownloadUrl: session.getFileDownloadUrl,
    deleteFile:       session.deleteFile,
    uploadImage:      session.uploadImage,
    listImages:       session.listImages,
    updateImageSettings: session.updateImageSettings,
    deleteImage:      session.deleteImage,
    getImageViewUrl:  session.getImageViewUrl,
    getDskUrl:        session.getDskUrl,
    listIcons:        session.listIcons,
    uploadIcon:       session.uploadIcon,
    deleteIcon:       session.deleteIcon,
    configureRelay:   session.configureRelay,
    updateRelay:      session.updateRelay,
    stopRelaySlot:    session.stopRelaySlot,
    stopRelay:        session.stopRelay,
    getRelayStatus:   session.getRelayStatus,
    getRelayHistory:  session.getRelayHistory,
    setRelayActive:   session.setRelayActive,
    getYouTubeConfig: session.getYouTubeConfig,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps -- all methods are stable

  return (
    <LangProvider>
      <SentLogContext.Provider value={sentLog}>
        <SessionContext.Provider value={session}>
          <ConnectionContext.Provider value={connectionValue}>
            <CaptionContext.Provider value={captionValue}>
              <SessionApiContext.Provider value={sessionApiValue}>
                <FileProvider>
                  <ToastProvider>
                    {children}
                  </ToastProvider>
                </FileProvider>
              </SessionApiContext.Provider>
            </CaptionContext.Provider>
          </ConnectionContext.Provider>
        </SessionContext.Provider>
      </SentLogContext.Provider>
    </LangProvider>
  );
}
