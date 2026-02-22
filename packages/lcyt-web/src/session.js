import { BackendCaptionSender } from 'lcyt/backend';

const CONFIG_KEY = 'lcyt-config';
const AUTO_CONNECT_KEY = 'lcyt-autoconnect';

let sender = null;

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

  emit('lcyt:connected', {
    sequence: state.sequence,
    syncOffset: state.syncOffset,
    backendUrl,
  });
}

export async function disconnect() {
  if (!sender) return;

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

  const data = await sender.send(text);
  state.sequence = sender.sequence;

  emit('lcyt:sequence-updated', { sequence: state.sequence });

  return data;
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
