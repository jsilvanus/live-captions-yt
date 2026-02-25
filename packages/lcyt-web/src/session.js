import { BackendCaptionSender } from 'lcyt/backend';
import * as sentLog from './sent-log.js';

const CONFIG_KEY = 'lcyt-config';
const AUTO_CONNECT_KEY = 'lcyt-autoconnect';

let sender = null;
let eventSource = null;

export const state = {
  connected: false,
  sessionId: null,
  sequence: 0,
  syncOffset: 0,
  startedAt: null,
  backendUrl: '',
  apiKey: '',
  streamKey: '',
};

// ─── Persistence ─────────────────────────────────────────

export function getPersistedConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // storage quota or private mode — ignore
  }
}

export function clearPersistedConfig() {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(AUTO_CONNECT_KEY);
}

export function getAutoConnect() {
  return localStorage.getItem(AUTO_CONNECT_KEY) === 'true';
}

export function setAutoConnect(value) {
  localStorage.setItem(AUTO_CONNECT_KEY, value ? 'true' : 'false');
}

// ─── Events ──────────────────────────────────────────────

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// ─── SSE ─────────────────────────────────────────────────

function openEventSource(backendUrl, token) {
  const url = `${backendUrl}/events?token=${encodeURIComponent(token)}`;
  eventSource = new EventSource(url);

  eventSource.addEventListener('caption_result', (e) => {
    const data = JSON.parse(e.data);
    sentLog.confirm(data.requestId, data);
    state.sequence = data.sequence;
    emit('lcyt:sequence-updated', { sequence: state.sequence });
  });

  eventSource.addEventListener('caption_error', (e) => {
    const data = JSON.parse(e.data);
    sentLog.markError(data.requestId);
    emit('lcyt:error', { message: data.error || 'Caption delivery failed' });
  });

  eventSource.addEventListener('session_closed', () => {
    disconnect();
  });

  // EventSource auto-reconnects on error; no extra handling needed
}

function closeEventSource() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

// ─── Connect / Disconnect ─────────────────────────────────

export async function connect({ backendUrl, apiKey, streamKey }) {
  if (state.connected) {
    await disconnect();
  }

  sender = new BackendCaptionSender({ backendUrl, apiKey, streamKey });
  await sender.start();

  state.connected = true;
  state.backendUrl = backendUrl;
  state.apiKey = apiKey;
  state.streamKey = streamKey;
  state.sequence = sender.sequence;
  state.syncOffset = sender.syncOffset;
  state.startedAt = sender.startedAt;

  saveConfig({ backendUrl, apiKey, streamKey });

  openEventSource(backendUrl, sender._token);

  emit('lcyt:connected', {
    sequence: state.sequence,
    syncOffset: state.syncOffset,
    backendUrl,
  });
}

export async function disconnect() {
  if (!sender) return;

  closeEventSource();

  try {
    await sender.end();
  } catch {
    // swallow — session may already be expired
  }

  sender = null;
  state.connected = false;
  emit('lcyt:disconnected');
}

// ─── Caption sending ──────────────────────────────────────

export async function send(text) {
  if (!sender || !state.connected) {
    throw new Error('Not connected');
  }

  // Returns { ok: true, requestId } immediately — YouTube delivery is async
  return sender.send(text);
}

export async function sendBatch(texts) {
  if (!sender || !state.connected) {
    throw new Error('Not connected');
  }

  return sender.sendBatch(texts.map(text => ({ text })));
}

// ─── Sync ─────────────────────────────────────────────────

export async function sync() {
  if (!sender || !state.connected) {
    throw new Error('Not connected');
  }

  const data = await sender.sync();
  state.syncOffset = sender.syncOffset;

  emit('lcyt:sync-updated', { syncOffset: state.syncOffset });

  return data;
}

// ─── Heartbeat ────────────────────────────────────────────

export async function heartbeat() {
  if (!sender || !state.connected) {
    throw new Error('Not connected');
  }

  const t0 = Date.now();
  const data = await sender.heartbeat();
  const roundTripTime = Date.now() - t0;

  state.sequence = sender.sequence;
  state.syncOffset = sender.syncOffset;

  emit('lcyt:sequence-updated', { sequence: state.sequence });

  return { ...data, roundTripTime };
}
