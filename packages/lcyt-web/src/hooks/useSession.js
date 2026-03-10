import { useState, useRef, useEffect } from 'react';
import { BackendCaptionSender } from 'lcyt/backend';
import { getEnabledTargets } from '../lib/targetConfig';

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
  // 'unknown' | 'checking' | 'ok' | 'unreachable'
  const [healthStatus, setHealthStatus] = useState('unknown');

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
    try { return localStorage.getItem(AUTO_CONNECT_KEY) === 'true'; } catch { return false; }
  }

  function setAutoConnect(value) {
    try { localStorage.setItem(AUTO_CONNECT_KEY, value ? 'true' : 'false'); } catch {}
  }

  function clearPersistedConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch {}
    try { localStorage.removeItem(AUTO_CONNECT_KEY); } catch {}
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
      if (import.meta.env.DEV) console.log(`[LCYT] caption_result seq=${data.sequence} status=${data.statusCode}`);
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

  // ─── Health check ────────────────────────────────────────

  async function checkHealth(url) {
    const target = url ?? backendUrlRef.current;
    if (!target) { setHealthStatus('unknown'); return false; }
    setHealthStatus('checking');
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const res = await fetch(`${target}/health`, { signal: ac.signal, cache: 'no-store' });
      clearTimeout(timer);
      setHealthStatus(res.ok ? 'ok' : 'unreachable');
      return res.ok;
    } catch {
      setHealthStatus('unreachable');
      return false;
    }
  }

  // ─── Connect / Disconnect ───────────────────────────────

  async function connect({ backendUrl: url, apiKey: key, streamKey: sk } = {}) {
    if (senderRef.current) await disconnect();

    // streamKey is optional in the new target-array architecture.
    // When omitted, the backend uses the targets array for all caption delivery.
    const sender = new BackendCaptionSender({ backendUrl: url, apiKey: key, streamKey: sk ?? null });

    // Build the targets list: parse headers JSON strings into objects for the backend.
    const rawTargets = getEnabledTargets();
    const targets = rawTargets.map(t => {
      if (t.type === 'youtube') {
        return { id: t.id, type: 'youtube', streamKey: t.streamKey };
      }
      if (t.type === 'viewer') {
        return { id: t.id, type: 'viewer', viewerKey: t.viewerKey };
      }
      let headers = {};
      if (t.headers) { try { headers = JSON.parse(t.headers); } catch {} }
      return { id: t.id, type: 'generic', url: t.url, headers };
    });

    await sender.start(targets.length > 0 ? { targets } : {});

    // Ensure we received a server token; rehydrated sessions may yield no
    // token if the backend didn't re-issue one. Fail fast and surface a
    // helpful error so the UI can prompt the user to re-open settings.
    if (!sender._token) {
      try { await sender.end(); } catch {} // best-effort cleanup
      const msg = 'No session token received from server; open Settings to re-register.';
      cbs.current.onError?.(msg);
      throw new Error(msg);
    }

    // Auto-sync clock with YouTube immediately after connecting.
    // Failure is non-fatal — connection proceeds with syncOffset=0.
    try { await sender.sync(); } catch {}

    senderRef.current = sender;
    backendUrlRef.current = url;

    setConnected(true);
    setHealthStatus('ok');
    setBackendUrl(url);
    setApiKey(key);
    setStreamKey(sk || '');
    setSequence(sender.sequence);
    setSyncOffset(sender.syncOffset);
    setStartedAt(sender.startedAt);

    // Persist backendUrl and apiKey; streamKey is omitted when not provided
    // since targets are now managed in the CC modal.
    const cfg = { backendUrl: url, apiKey: key };
    if (sk) cfg.streamKey = sk;
    saveConfig(cfg);
    openEventSource(url, sender._token);

    cbs.current.onConnected?.({
      sequence: sender.sequence,
      syncOffset: sender.syncOffset,
      backendUrl: url,
      token: sender._token,
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

  function _translationMeta(opts) {
    const translations = opts?.translations || {};
    const captionLang = opts?.captionLang || null;
    const showOriginal = opts?.showOriginal ?? false;
    const captionTranslationText = captionLang ? (translations[captionLang] ?? null) : null;
    const otherTranslations = Object.fromEntries(
      Object.entries(translations).filter(([lang]) => lang !== captionLang)
    );
    const hasTranslations = Object.keys(translations).length > 0;
    return { hasTranslations, captionLang, captionTranslationText, showOriginal, otherTranslations };
  }

  async function send(text, timestamp, opts) {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.send(text, timestamp, opts);
    const meta = _translationMeta(opts);
    cbs.current.onCaptionSent?.({ requestId: data.requestId, text, pending: true, ...meta });
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
  async function construct(text, timestamp, opts) {
    if (!text || typeof text !== 'string') return 0;
    if (!senderRef.current) throw new Error('Not connected');

    const intervalMs = getBatchIntervalMs();
    // Immediate send if batching is disabled
    if (intervalMs === 0) {
      const data = await send(text, timestamp, opts);
      return data;
    }

    const tempId = 'q-' + Math.random().toString(36).slice(2);
    const meta = _translationMeta(opts);
    // Tell host a pending item exists
    cbs.current.onCaptionSent?.({ requestId: tempId, text, pending: true, ...meta });
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

  /**
   * Push an updated targets list to the backend session.
   * Each entry from localStorage has headers as a raw JSON string;
   * we parse them here before sending to the backend.
   *
   * @param {Array} rawTargets - Array from getEnabledTargets() (headers as JSON string)
   * @returns {Promise<void>}
   */
  async function updateTargets(rawTargets) {
    if (!senderRef.current) return; // not connected — localStorage already has the new config
    const targets = rawTargets.map(t => {
      if (t.type === 'youtube') {
        return { id: t.id, type: 'youtube', streamKey: t.streamKey };
      }
      if (t.type === 'viewer') {
        return { id: t.id, type: 'viewer', viewerKey: t.viewerKey };
      }
      let headers = {};
      // headers is stored as a raw JSON string in localStorage; parse it here.
      // Invalid JSON falls back to empty headers (backend ignores unrecognised keys).
      if (t.headers) {
        try { headers = JSON.parse(t.headers); } catch (err) {
          if (import.meta.env.DEV) console.warn('[updateTargets] Could not parse headers JSON for target', t.id, err?.message);
        }
      }
      return { id: t.id, type: 'generic', url: t.url, headers };
    });
    await senderRef.current.updateSession({ targets });
  }

  // ─── Self-service account management ────────────────────

  async function getStats() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
    return res.json();
  }

  /**
   * List backend caption files for the current session's API key.
   */
  async function listFiles() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to list files (${res.status})`);
    return res.json();
  }

  /**
   * Get the download URL for a backend caption file.
   */
  function getFileDownloadUrl(fileId) {
    const token = senderRef.current?._token;
    const url = backendUrlRef.current;
    if (!token || !url) return null;
    return `${url}/file/${fileId}?token=${encodeURIComponent(token)}`;
  }

  /**
   * Delete a backend caption file.
   */
  async function deleteFile(fileId) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/file/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to delete file (${res.status})`);
    return res.json();
  }

  // ─── Icons ──────────────────────────────────────────────

  /**
   * List icons uploaded for the current API key.
   * @returns {Promise<{ icons: object[] }>}
   */
  async function listIcons() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/icons`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to list icons (${res.status})`);
    return res.json();
  }

  /**
   * Upload a PNG or SVG icon.
   * @param {{ filename: string, mimeType: string, data: string }} opts
   *   data is a base64-encoded string of the file contents.
   * @returns {Promise<{ ok: boolean, id: number, filename: string, mimeType: string, sizeBytes: number }>}
   */
  async function uploadIcon({ filename, mimeType, data }) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/icons`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, mimeType, data }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to upload icon (${res.status})`);
    }
    return res.json();
  }

  /**
   * Delete an icon by id.
   * @param {number} iconId
   */
  async function deleteIcon(iconId) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/icons/${iconId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to delete icon (${res.status})`);
    }
    return res.json();
  }

  /**
   * GDPR right-to-erasure: anonymises the API key on the backend, disconnects locally,
   * and clears all persisted config from localStorage.
   */
  async function eraseSelf() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stats`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Erasure failed (${res.status})`);
    // Disconnect locally (SSE already closed by server) and clear saved credentials
    await disconnect();
    clearPersistedConfig();
    return res.json();
  }

  // ─── RTMP relay ─────────────────────────────────────────

  /**
   * Configure (create / replace) the relay target.
   * Requires relay_allowed on the API key.
   * @param {{ slot?: number, targetUrl: string, targetName?: string|null, captionMode?: string }} opts
   */
  async function configureRelay({ slot = 1, targetUrl, targetName = null, captionMode = 'http' } = {}) {
    if (!targetUrl) throw new Error('targetUrl is required');
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, targetUrl, targetName, captionMode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to configure relay (${res.status})`);
    }
    return res.json();
  }

  /**
   * Update an existing relay slot.
   * @param {{ slot: number, targetUrl: string, targetName?: string|null, captionMode?: string }} opts
   */
  async function updateRelay({ slot = 1, targetUrl, targetName = null, captionMode = 'http' } = {}) {
    if (!targetUrl) throw new Error('targetUrl is required');
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stream/${slot}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl, targetName, captionMode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to update relay slot ${slot} (${res.status})`);
    }
    return res.json();
  }

  /**
   * Stop and remove a specific relay slot.
   * @param {{ slot: number }} opts
   */
  async function stopRelaySlot({ slot = 1 } = {}) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stream/${slot}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to stop relay slot ${slot} (${res.status})`);
    }
    return res.json();
  }

  /**
   * Stop all relay slots and drop the nginx publisher.
   */
  async function stopRelay() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stream`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to stop relay (${res.status})`);
    }
    return res.json();
  }

  /**
   * Fetch the YouTube OAuth client ID configured on the backend.
   * @returns {Promise<{ clientId: string }>}
   */
  async function getYouTubeConfig() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/youtube/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `YouTube config unavailable (${res.status})`);
    }
    return res.json();
  }

  /**
   * Get all configured relay slots and which are running.
   * @returns {{ relays: object[], runningSlots: number[], active: boolean }}
   */
  async function getRelayStatus() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to get relay status (${res.status})`);
    return res.json();
  }

  /**
   * Get per-stream RTMP usage history for this API key.
   * @returns {{ streams: object[] }}
   */
  async function getRelayHistory() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stream/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to get relay history (${res.status})`);
    return res.json();
  }

  /**
   * Set the relay active state for this API key.
   * When active=true and nginx is currently publishing, fan-out starts immediately.
   * When active=false, all running ffmpeg processes are stopped.
   * @param {boolean} active
   * @returns {Promise<{ ok: boolean, active: boolean }>}
   */
  async function setRelayActive(active) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/stream/active`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to set relay active state (${res.status})`);
    }
    return res.json();
  }

  return {
    connected, sequence, syncOffset, backendUrl, apiKey, streamKey, startedAt,
    micHolder, clientId: CLIENT_ID,
    healthStatus, checkHealth,
    connect, disconnect, send, sendBatch, construct, flushBatch, sync, heartbeat, updateSequence, updateTargets,
    claimMic, releaseMic,
    getStats, eraseSelf,
    listFiles, getFileDownloadUrl, deleteFile,
    listIcons, uploadIcon, deleteIcon,
    configureRelay, updateRelay, stopRelaySlot, stopRelay, getRelayStatus, getRelayHistory, setRelayActive,
    getYouTubeConfig,
    getPersistedConfig, getAutoConnect, setAutoConnect, clearPersistedConfig,
  };
}
