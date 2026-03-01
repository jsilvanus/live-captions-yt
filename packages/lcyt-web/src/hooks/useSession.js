import { useState, useRef, useEffect } from 'react';
import { BackendCaptionSender } from 'lcyt/backend';

// Stable per-tab client ID for the soft mic lock
const CLIENT_ID = crypto.randomUUID();

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
  onBatchSent,
} = {}) {
  const [connected, setConnected] = useState(false);
  const [sequence, setSequence] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0);
  const [backendUrl, setBackendUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [micHolder, setMicHolder] = useState(null);

  const senderRef = useRef(null);
  const esRef = useRef(null);
  // Keep backendUrl in a ref so claimMic/releaseMic always have the current value
  const backendUrlRef = useRef('');

  // Keep all callbacks in a ref so SSE handlers always see the latest version
  const cbs = useRef({});
  cbs.current = { onConnected, onDisconnected, onCaptionSent, onCaptionResult, onCaptionError, onSyncUpdated, onError, onBatchSent };

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

    es.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data);
      // Sync mic lock state immediately on SSE connection
      setMicHolder(data.micHolder ?? null);
    });

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

    es.addEventListener('mic_state', (e) => {
      const data = JSON.parse(e.data);
      setMicHolder(data.holder ?? null);
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

    // Auto-sync clock with YouTube immediately after connecting.
    // Failure is non-fatal — connection proceeds with syncOffset=0.
    try { await sender.sync(); } catch {}

    senderRef.current = sender;
    backendUrlRef.current = url;

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
    backendUrlRef.current = '';

    setConnected(false);
    setSequence(0);
    setSyncOffset(0);
    setStartedAt(null);
    setMicHolder(null);

    cbs.current.onDisconnected?.();
  }

  // ─── Caption sending ────────────────────────────────────

  async function send(text, timestamp) {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.send(text, timestamp);
    cbs.current.onCaptionSent?.({ requestId: data.requestId, text, pending: true });
    return data;
  }

  async function sendBatch(texts) {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.sendBatch(texts.map(text => ({ text })));
    texts.forEach(text => cbs.current.onCaptionSent?.({ requestId: data.requestId, text, pending: true }));
    return data;
  }

  // ─── Sync / Heartbeat ───────────────────────────────────

  async function sync() {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.sync();
    setSyncOffset(senderRef.current.syncOffset);
    return data;
  }

  // ─── Batch/Construct Logic ──────────────────────────────

  const batchBufferRef = useRef([]); // [{ text, requestId }]
  const batchTimerRef = useRef(null);

  function getBatchIntervalMs() {
    try {
      const v = parseInt(localStorage.getItem('lcyt-batch-interval') || '0', 10);
      return Math.min(20, Math.max(0, v)) * 1000;
    } catch { return 0; }
  }

  async function flushBatch() {
    const items = batchBufferRef.current.slice();
    batchBufferRef.current = [];
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }
    if (!items.length) return;

    if (!senderRef.current) throw new Error('Not connected');

    try {
      const data = await senderRef.current.sendBatch(); // drains sender queue
      // Notify host that the temp ids now map to the real requestId
      cbs.current.onBatchSent?.({ tempIds: items.map(i => i.requestId), requestId: data.requestId, count: data.count });
      return data;
    } catch (err) {
      // Mark entries as errored via callback
      items.forEach(i => cbs.current.onCaptionError?.({ requestId: i.requestId, error: err.message }));
      throw err;
    }
  }

  // Add a caption to the server-side batch queue (sender.construct)
  async function construct(text, timestamp) {
    if (!text || typeof text !== 'string') return 0;
    if (!senderRef.current) throw new Error('Not connected');

    const intervalMs = getBatchIntervalMs();
    // Immediate send if batching is disabled
    if (intervalMs === 0) {
      const data = await send(text, timestamp);
      return data;
    }

    const tempId = 'q-' + Math.random().toString(36).slice(2);
    // Tell host a pending item exists
    cbs.current.onCaptionSent?.({ requestId: tempId, text, pending: true });
    // Push into sender queue
    senderRef.current.construct(text, timestamp);
    batchBufferRef.current.push({ text, requestId: tempId });

    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(() => { flushBatch().catch(() => {}); }, intervalMs);
    }

    return { tempId };
  }

  function getQueuedCount() {
    return batchBufferRef.current.length;
  }

  // ─── Mic soft lock ──────────────────────────────────────

  async function _postMic(action) {
    const token = senderRef.current?._token;
    const url = backendUrlRef.current;
    if (!token || !url) return;
    try {
      await fetch(`${url}/mic`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, clientId: CLIENT_ID }),
      });
    } catch { /* soft lock — ignore network errors */ }
  }

  function claimMic() { return _postMic('claim'); }
  function releaseMic() { return _postMic('release'); }

  async function heartbeat() {
    if (!senderRef.current) throw new Error('Not connected');
    const t0 = Date.now();
    const data = await senderRef.current.heartbeat();
    const roundTripTime = Date.now() - t0;
    setSequence(senderRef.current.sequence);
    setSyncOffset(senderRef.current.syncOffset);
    return { ...data, roundTripTime };
  }

  // Update session fields on the backend (e.g. sequence)
  async function updateSequence(seq) {
    if (!senderRef.current) throw new Error('Not connected');
    await senderRef.current.updateSession({ sequence: seq });
    // Mirror locally
    setSequence(Number(seq));
  }

  return {
    connected, sequence, syncOffset, backendUrl, apiKey, streamKey, startedAt,
    micHolder, clientId: CLIENT_ID,
    connect, disconnect, send, sendBatch, construct, flushBatch, sync, heartbeat, updateSequence,
    claimMic, releaseMic,
    getPersistedConfig, getAutoConnect, setAutoConnect, clearPersistedConfig,
  };
}
