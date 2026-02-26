import { useState, useRef, useEffect } from 'react';
import { BackendCaptionSender } from 'lcyt/backend';

const CONFIG_KEY = 'lcyt-config';
const AUTO_CONNECT_KEY = 'lcyt-autoconnect';

/**
 * Manages a BackendCaptionSender session, SSE subscription, and config persistence.
 *
 * @param {object} [opts]
 * @param {function} [opts.onConnected]     - ({ sequence, syncOffset, backendUrl }) => void
 * @param {function} [opts.onDisconnected]  - () => void
 * @param {function} [opts.onCaptionSent]   - ({ requestId, text }) => void  (fires on 202 response)
 * @param {function} [opts.onCaptionResult] - ({ requestId, sequence, serverTimestamp }) => void  (SSE confirm)
 * @param {function} [opts.onCaptionError]  - ({ requestId, error, statusCode }) => void  (SSE error)
 * @param {function} [opts.onSyncUpdated]   - ({ syncOffset, roundTripTime }) => void
 * @param {function} [opts.onError]         - (message: string) => void
 */
export function useSession({
  onConnected,
  onDisconnected,
  onCaptionSent,
  onCaptionResult,
  onCaptionError,
  onSyncUpdated,
  onError,
} = {}) {
  const [connected, setConnected] = useState(false);
  const [sequence, setSequence] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0);
  const [backendUrl, setBackendUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [startedAt, setStartedAt] = useState(null);

  const senderRef = useRef(null);
  const esRef = useRef(null);

  // Keep all callbacks in a ref so SSE handlers always see the latest version
  const cbs = useRef({});
  cbs.current = { onConnected, onDisconnected, onCaptionSent, onCaptionResult, onCaptionError, onSyncUpdated, onError };

  // Close EventSource on unmount
  useEffect(() => () => { esRef.current?.close(); }, []);

  // ─── Persistence ────────────────────────────────────────

  function getPersistedConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function saveConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch {}
  }

  function getAutoConnect() {
    return localStorage.getItem(AUTO_CONNECT_KEY) === 'true';
  }

  function setAutoConnect(value) {
    localStorage.setItem(AUTO_CONNECT_KEY, value ? 'true' : 'false');
  }

  function clearPersistedConfig() {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(AUTO_CONNECT_KEY);
  }

  // ─── SSE ────────────────────────────────────────────────

  function openEventSource(url, token) {
    esRef.current?.close();
    const es = new EventSource(`${url}/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.addEventListener('caption_result', (e) => {
      const data = JSON.parse(e.data);
      setSequence(data.sequence);
      cbs.current.onCaptionResult?.(data);
    });

    es.addEventListener('caption_error', (e) => {
      const data = JSON.parse(e.data);
      cbs.current.onCaptionError?.(data);
      cbs.current.onError?.(data.error || 'Caption delivery failed');
    });

    es.addEventListener('session_closed', () => {
      disconnect();
    });
  }

  // ─── Connect / Disconnect ───────────────────────────────

  async function connect({ backendUrl: url, apiKey: key, streamKey: sk }) {
    if (senderRef.current) await disconnect();

    const sender = new BackendCaptionSender({ backendUrl: url, apiKey: key, streamKey: sk });
    await sender.start();
    senderRef.current = sender;

    setConnected(true);
    setBackendUrl(url);
    setApiKey(key);
    setStreamKey(sk);
    setSequence(sender.sequence);
    setSyncOffset(sender.syncOffset);
    setStartedAt(sender.startedAt);

    saveConfig({ backendUrl: url, apiKey: key, streamKey: sk });
    openEventSource(url, sender._token);

    cbs.current.onConnected?.({
      sequence: sender.sequence,
      syncOffset: sender.syncOffset,
      backendUrl: url,
    });
  }

  async function disconnect() {
    if (!senderRef.current) return;

    esRef.current?.close();
    esRef.current = null;

    try { await senderRef.current.end(); } catch {}
    senderRef.current = null;

    setConnected(false);
    setSequence(0);
    setSyncOffset(0);
    setStartedAt(null);

    cbs.current.onDisconnected?.();
  }

  // ─── Caption sending ────────────────────────────────────

  async function send(text) {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.send(text);
    cbs.current.onCaptionSent?.({ requestId: data.requestId, text });
    return data;
  }

  async function sendBatch(texts) {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.sendBatch(texts.map(text => ({ text })));
    texts.forEach(text => cbs.current.onCaptionSent?.({ requestId: data.requestId, text }));
    return data;
  }

  // ─── Sync / Heartbeat ───────────────────────────────────

  async function sync() {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.sync();
    const newOffset = senderRef.current.syncOffset;
    setSyncOffset(newOffset);
    cbs.current.onSyncUpdated?.({ syncOffset: newOffset, roundTripTime: data.roundTripTime });
    return data;
  }

  async function heartbeat() {
    if (!senderRef.current) throw new Error('Not connected');
    const t0 = Date.now();
    const data = await senderRef.current.heartbeat();
    const roundTripTime = Date.now() - t0;
    setSequence(senderRef.current.sequence);
    setSyncOffset(senderRef.current.syncOffset);
    return { ...data, roundTripTime };
  }

  return {
    connected, sequence, syncOffset, backendUrl, apiKey, streamKey, startedAt,
    connect, disconnect, send, sendBatch, sync, heartbeat,
    getPersistedConfig, getAutoConnect, setAutoConnect, clearPersistedConfig,
  };
}
