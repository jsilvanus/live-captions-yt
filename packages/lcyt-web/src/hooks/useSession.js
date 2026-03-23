import { useState, useRef, useEffect, useCallback } from 'react';
import { BackendCaptionSender } from 'lcyt/backend';
import { getEnabledTargets } from '../lib/targetConfig';
import { createApi } from '../lib/api';
import { KEYS } from '../lib/storageKeys.js';

// Stable per-tab client ID for the soft mic lock
const CLIENT_ID = crypto.randomUUID();

const CONFIG_KEY = KEYS.session.config;
const AUTO_CONNECT_KEY = KEYS.session.autoConnect;

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
  const [graphicsEnabled, setGraphicsEnabled] = useState(false);
  // 'unknown' | 'checking' | 'ok' | 'unreachable'
  const [healthStatus, setHealthStatus] = useState('unknown');
  const [latencyMs, setLatencyMs] = useState(null);
  // Auto-reconnect state
  const [reconnecting, setReconnecting] = useState(false);

  const senderRef = useRef(null);
  const esRef = useRef(null);
  // Keep backendUrl in a ref so claimMic/releaseMic always have the current value
  const backendUrlRef = useRef('');

  // Reconnect state (all mutable, stored in refs to avoid stale closures in timers)
  const reconnectTimerRef    = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectConfigRef   = useRef(null); // stores last successful connect config

  // Authenticated fetch helper — always reads current token + URL from refs
  const api = createApi(senderRef, backendUrlRef);

  // Keep all callbacks in a ref so SSE handlers always see the latest version
  const cbs = useRef({});
  cbs.current = { onConnected, onDisconnected, onCaptionSent, onCaptionResult, onCaptionError, onSyncUpdated, onError, onBatchSent };

  // Close EventSource + cancel reconnect on unmount
  useEffect(() => () => {
    esRef.current?.close();
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
  }, []);

  // Periodic health poll while connected.
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => { checkHealth().catch(() => {}); }, 30_000);
    return () => clearInterval(id);
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Persistence ────────────────────────────────────────

  const getPersistedConfig = useCallback(function getPersistedConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }, []);

  const saveConfig = useCallback(function saveConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch {}
  }, []);

  const getAutoConnect = useCallback(function getAutoConnect() {
    try { return localStorage.getItem(AUTO_CONNECT_KEY) === 'true'; } catch { return false; }
  }, []);

  const setAutoConnect = useCallback(function setAutoConnect(value) {
    try { localStorage.setItem(AUTO_CONNECT_KEY, value ? 'true' : 'false'); } catch {}
  }, []);

  const clearPersistedConfig = useCallback(function clearPersistedConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch {}
    try { localStorage.removeItem(AUTO_CONNECT_KEY); } catch {}
  }, []);

  // ─── Auto-reconnect helpers ──────────────────────────────

  const _cancelReconnect = useCallback(function _cancelReconnect() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    setReconnecting(false);
  }, []);

  // Internal disconnect (does NOT cancel pending reconnect).
  // Called by session_closed SSE event and by _scheduleReconnect on failure.
  const _disconnectInternal = useCallback(async function _disconnectInternal() {
    esRef.current?.close();
    esRef.current = null;

    if (senderRef.current) {
      try { await senderRef.current.end(); } catch {}
      senderRef.current = null;
    }
    backendUrlRef.current = '';

    setConnected(false);
    setSequence(0);
    setSyncOffset(0);
    setStartedAt(null);
    setMicHolder(null);
    setGraphicsEnabled(false);

    cbs.current.onDisconnected?.();
  }, []);

  // Ref to the latest connect function — avoids stale closure in reconnect timer
  const connectRef = useRef(null);

  // Ref to the latest _scheduleReconnect — used for recursive retry in timer callback
  const scheduleReconnectRef = useRef(null);

  const _scheduleReconnect = useCallback(function _scheduleReconnect(cfg) {
    if (!cfg) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Exponential backoff: 2s → 4s → 8s → 16s → 30s max
    const delay = Math.min(30_000, 2_000 * Math.pow(2, reconnectAttemptsRef.current));
    reconnectConfigRef.current = cfg;
    setReconnecting(true);
    reconnectTimerRef.current = setTimeout(function () {
      reconnectTimerRef.current = null;
      connectRef.current(reconnectConfigRef.current)
        .then(function () {
          reconnectAttemptsRef.current = 0;
          // reconnectConfigRef is kept for future reconnects (set again on connect success)
          setReconnecting(false);
        })
        .catch(function () {
          reconnectAttemptsRef.current++;
          scheduleReconnectRef.current(reconnectConfigRef.current);
        });
    }, delay);
  }, []); // stable: all state accessed via refs

  // Keep the refs up to date on every render
  scheduleReconnectRef.current = _scheduleReconnect;

  // ─── SSE ────────────────────────────────────────────────

  const openEventSource = useCallback(function openEventSource(url, token) {
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
      // Server terminated the session — disconnect internally then attempt reconnect
      _disconnectInternal().then(() => {
        const cfg = reconnectConfigRef.current;
        if (cfg) scheduleReconnectRef.current(cfg);
      });
    });
  }, [_disconnectInternal]);

  // ─── Health check ────────────────────────────────────────

  const checkHealth = useCallback(async function checkHealth(url) {
    const target = url ?? backendUrlRef.current;
    if (!target) { setHealthStatus('unknown'); setLatencyMs(null); return false; }
    setHealthStatus('checking');
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const t0 = Date.now();
      const res = await fetch(`${target}/health`, { signal: ac.signal, cache: 'no-store' });
      const rtt = Date.now() - t0;
      clearTimeout(timer);
      if (res.ok) {
        setHealthStatus('ok');
        setLatencyMs(rtt);
      } else {
        setHealthStatus('unreachable');
        setLatencyMs(null);
      }
      return res.ok;
    } catch {
      setHealthStatus('unreachable');
      setLatencyMs(null);
      return false;
    }
  }, []);

  // ─── Connect / Disconnect ───────────────────────────────

  const connect = useCallback(async function connect({ backendUrl: url, apiKey: key, streamKey: sk } = {}) {
    // Disconnect any existing session (internally, without canceling reconnect state)
    if (senderRef.current) await _disconnectInternal();

    // streamKey is optional in the new target-array architecture.
    const sender = new BackendCaptionSender({ backendUrl: url, apiKey: key, streamKey: sk ?? null });

    // Build the targets list
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

    if (!sender._token) {
      try { await sender.end(); } catch {}
      const msg = 'No session token received from server; open Settings to re-register.';
      cbs.current.onError?.(msg);
      throw new Error(msg);
    }

    // Auto-sync clock with YouTube immediately after connecting.
    try { await sender.sync(); } catch {}

    senderRef.current = sender;
    backendUrlRef.current = url;

    // Store config for auto-reconnect (cleared on manual disconnect)
    reconnectConfigRef.current = { backendUrl: url, apiKey: key, streamKey: sk ?? null };

    setConnected(true);
    setReconnecting(false);
    setHealthStatus('ok');
    setBackendUrl(url);
    setApiKey(key);
    setStreamKey(sk || '');
    setSequence(sender.sequence);
    setSyncOffset(sender.syncOffset);
    setStartedAt(sender.startedAt);
    setGraphicsEnabled(sender.graphicsEnabled === true);

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
  }, [_disconnectInternal, openEventSource, saveConfig]);

  // Keep connectRef current for the reconnect timer callback
  connectRef.current = connect;

  // Public disconnect — cancels any pending auto-reconnect
  const disconnect = useCallback(async function disconnect() {
    _cancelReconnect();
    reconnectConfigRef.current = null;
    if (!senderRef.current) return;
    await _disconnectInternal();
  }, [_cancelReconnect, _disconnectInternal]);

  // Manual "reconnect now" — used by the ReconnectBanner button
  const reconnectNow = useCallback(function reconnectNow() {
    const cfg = reconnectConfigRef.current;
    if (!cfg) return;
    _cancelReconnect();
    connect(cfg).catch(function () {
      reconnectAttemptsRef.current++;
      scheduleReconnectRef.current(cfg);
    });
  }, [_cancelReconnect, connect]);

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

  const send = useCallback(async function send(text, timestamp, opts) {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.send(text, timestamp, opts);
    const meta = _translationMeta(opts);
    cbs.current.onCaptionSent?.({ requestId: data.requestId, text, pending: true, ...meta });
    return data;
  }, []);

  const sendBatch = useCallback(async function sendBatch(texts) {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.sendBatch(texts.map(text => ({ text })));
    texts.forEach(text => cbs.current.onCaptionSent?.({ requestId: data.requestId, text, pending: true }));
    return data;
  }, []);

  // ─── Sync / Heartbeat ───────────────────────────────────

  const sync = useCallback(async function sync() {
    if (!senderRef.current) throw new Error('Not connected');
    const data = await senderRef.current.sync();
    setSyncOffset(senderRef.current.syncOffset);
    return data;
  }, []);

  // ─── Batch/Construct Logic ──────────────────────────────

  const batchBufferRef = useRef([]); // [{ text, requestId }]
  const batchTimerRef  = useRef(null);

  const getBatchIntervalMs = useCallback(function getBatchIntervalMs() {
    try {
      const v = parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10);
      return Math.min(20, Math.max(0, v)) * 1000;
    } catch { return 0; }
  }, []);

  const flushBatch = useCallback(async function flushBatch() {
    const items = batchBufferRef.current.slice();
    batchBufferRef.current = [];
    if (batchTimerRef.current) { clearTimeout(batchTimerRef.current); batchTimerRef.current = null; }
    if (!items.length) return;

    if (!senderRef.current) throw new Error('Not connected');

    try {
      const data = await senderRef.current.sendBatch(); // drains sender queue
      cbs.current.onBatchSent?.({ tempIds: items.map(i => i.requestId), requestId: data.requestId, count: data.count });
      return data;
    } catch (err) {
      items.forEach(i => cbs.current.onCaptionError?.({ requestId: i.requestId, error: err.message }));
      throw err;
    }
  }, []);

  // Keep a ref to the latest flushBatch so construct's timer callback always calls the current version
  const flushBatchRef = useRef(flushBatch);
  flushBatchRef.current = flushBatch;

  const construct = useCallback(async function construct(text, timestamp, opts) {
    if (!text || typeof text !== 'string') return 0;
    if (!senderRef.current) throw new Error('Not connected');

    const intervalMs = getBatchIntervalMs();
    if (intervalMs === 0) {
      // Immediate send if batching is disabled
      const data = await sendRef.current(text, timestamp, opts);
      return data;
    }

    const tempId = 'q-' + Math.random().toString(36).slice(2);
    const meta = _translationMeta(opts);
    cbs.current.onCaptionSent?.({ requestId: tempId, text, pending: true, ...meta });
    senderRef.current.construct(text, timestamp);
    batchBufferRef.current.push({ text, requestId: tempId });

    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(() => { flushBatchRef.current().catch(() => {}); }, intervalMs);
    }

    return { tempId };
  }, [getBatchIntervalMs]);

  // Keep a ref so construct's timer callback always gets the latest send
  const sendRef = useRef(send);
  sendRef.current = send;

  const getQueuedCount = useCallback(function getQueuedCount() {
    return batchBufferRef.current.length;
  }, []);

  // ─── Mic soft lock ──────────────────────────────────────

  const _postMic = useCallback(async function _postMic(action) {
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
  }, []);

  const claimMic   = useCallback(function claimMic()   { return _postMic('claim');   }, [_postMic]);
  const releaseMic = useCallback(function releaseMic() { return _postMic('release'); }, [_postMic]);

  const heartbeat = useCallback(async function heartbeat() {
    if (!senderRef.current) throw new Error('Not connected');
    const t0 = Date.now();
    const data = await senderRef.current.heartbeat();
    const roundTripTime = Date.now() - t0;
    setSequence(senderRef.current.sequence);
    setSyncOffset(senderRef.current.syncOffset);
    return { ...data, roundTripTime };
  }, []);

  const updateSequence = useCallback(async function updateSequence(seq) {
    if (!senderRef.current) throw new Error('Not connected');
    await senderRef.current.updateSession({ sequence: seq });
    setSequence(Number(seq));
  }, []);

  const updateTargets = useCallback(async function updateTargets(rawTargets) {
    if (!senderRef.current) return;
    const targets = rawTargets.map(t => {
      if (t.type === 'youtube') {
        return { id: t.id, type: 'youtube', streamKey: t.streamKey };
      }
      if (t.type === 'viewer') {
        return { id: t.id, type: 'viewer', viewerKey: t.viewerKey };
      }
      let headers = {};
      if (t.headers) {
        try { headers = JSON.parse(t.headers); } catch (err) {
          if (import.meta.env.DEV) console.warn('[updateTargets] Could not parse headers JSON for target', t.id, err?.message);
        }
      }
      return { id: t.id, type: 'generic', url: t.url, headers };
    });
    await senderRef.current.updateSession({ targets });
  }, []);

  // ─── Image / graphics management ────────────────────────

  const uploadImage = useCallback(async function uploadImage(file, shorthand) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const form = new FormData();
    form.append('file', file);
    form.append('shorthand', shorthand);
    const res = await fetch(`${url}/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed (${res.status})`);
    }
    return res.json();
  }, []);

  const listImages = useCallback(async function listImages() {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/images`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to list images (${res.status})`);
    return res.json();
  }, []);

  const deleteImage = useCallback(async function deleteImage(id) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;
    const res = await fetch(`${url}/images/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to delete image (${res.status})`);
    return res.json();
  }, []);

  const updateImageSettings = useCallback(async function updateImageSettings(id, settings) {
    // settings: object that will be stored as settingsJson on the image row
    return api.put(`/images/${id}`, { settingsJson: settings });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getImageViewUrl = useCallback(function getImageViewUrl(id) {
    const url = backendUrlRef.current;
    if (!url) return null;
    return `${url}/images/${id}`;
  }, []);

  const getDskUrl = useCallback(function getDskUrl(opts = {}) {
    const key = senderRef.current?.apiKey;
    const serverUrl = backendUrlRef.current;
    if (!key || !serverUrl) return null;
    const params = new URLSearchParams({ server: serverUrl });
    if (opts.cc) params.set('cc', '1');
    if (opts.bg) params.set('bg', opts.bg);
    return `/dsk/${key}?${params}`;
  }, []);

  // ─── Self-service account management ────────────────────

  const getStats = useCallback(async function getStats() {
    return api.get('/stats');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const eraseSelf = useCallback(async function eraseSelf() {
    const data = await api.del('/stats');
    await disconnect();
    clearPersistedConfig();
    return data;
  }, [disconnect, clearPersistedConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const listFiles = useCallback(async function listFiles() {
    return api.get('/file');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getFileDownloadUrl = useCallback(function getFileDownloadUrl(fileId) {
    const token = senderRef.current?._token;
    const url = backendUrlRef.current;
    if (!token || !url) return null;
    return `${url}/file/${fileId}?token=${encodeURIComponent(token)}`;
  }, []);

  const deleteFile = useCallback(async function deleteFile(fileId) {
    return api.del(`/file/${fileId}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Icons ──────────────────────────────────────────────

  const listIcons = useCallback(async function listIcons() {
    return api.get('/icons');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const uploadIcon = useCallback(async function uploadIcon({ filename, mimeType, data }) {
    return api.post('/icons', { filename, mimeType, data });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteIcon = useCallback(async function deleteIcon(iconId) {
    return api.del(`/icons/${iconId}`, { parseErrorBody: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const eraseSelfRef = useRef(eraseSelf);
  eraseSelfRef.current = eraseSelf;

  // ─── RTMP relay ─────────────────────────────────────────

  const configureRelay = useCallback(async function configureRelay({ slot = 1, targetUrl, targetName = null, captionMode = 'http', scale, fps, videoBitrate, audioBitrate } = {}) {
    if (!targetUrl) throw new Error('targetUrl is required');
    const body = { slot, targetUrl, targetName, captionMode };
    if (scale) body.scale = scale;
    if (fps != null) body.fps = fps;
    if (videoBitrate) body.videoBitrate = videoBitrate;
    if (audioBitrate) body.audioBitrate = audioBitrate;
    return api.post('/stream', body);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRelay = useCallback(async function updateRelay({ slot = 1, targetUrl, targetName = null, captionMode = 'http', scale, fps, videoBitrate, audioBitrate } = {}) {
    if (!targetUrl) throw new Error('targetUrl is required');
    const body = { targetUrl, targetName, captionMode };
    if (scale) body.scale = scale;
    if (fps != null) body.fps = fps;
    if (videoBitrate) body.videoBitrate = videoBitrate;
    if (audioBitrate) body.audioBitrate = audioBitrate;
    return api.put(`/stream/${slot}`, body);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRelaySlot = useCallback(async function stopRelaySlot({ slot = 1 } = {}) {
    return api.del(`/stream/${slot}`, { parseErrorBody: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRelay = useCallback(async function stopRelay() {
    return api.del('/stream', { parseErrorBody: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getYouTubeConfig = useCallback(async function getYouTubeConfig() {
    return api.get('/youtube/config');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getRelayStatus = useCallback(async function getRelayStatus() {
    return api.get('/stream');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getRelayHistory = useCallback(async function getRelayHistory() {
    return api.get('/stream/history');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRelayActive = useCallback(async function setRelayActive(active) {
    return api.put('/stream/active', { active });
  }, []);

  const getSttStatus = useCallback(function getSttStatus() {
    return api.get('/stt/status');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connected, sequence, syncOffset, backendUrl, apiKey, streamKey, startedAt,
    micHolder, clientId: CLIENT_ID, graphicsEnabled,
    healthStatus, latencyMs, checkHealth,
    reconnecting, reconnectNow,
    connect, disconnect, send, sendBatch, construct, flushBatch, sync, heartbeat, updateSequence, updateTargets,
    claimMic, releaseMic,
    getStats, eraseSelf,
    listFiles, getFileDownloadUrl, deleteFile,
    uploadImage, listImages, deleteImage, getImageViewUrl, getDskUrl,
    updateImageSettings,
    listIcons, uploadIcon, deleteIcon,
    configureRelay, updateRelay, stopRelaySlot, stopRelay, getRelayStatus, getRelayHistory, setRelayActive,
    getYouTubeConfig,
    getSttStatus,
    getPersistedConfig, getAutoConnect, setAutoConnect, clearPersistedConfig,
    getQueuedCount,
  };
}
