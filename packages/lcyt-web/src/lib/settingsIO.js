import { KEYS, relaySlotKey } from './storageKeys.js';

const RELAY_FIELDS = ['type', 'ytKey', 'genericUrl', 'genericName', 'captionMode', 'scale', 'fps', 'videoBitrate', 'audioBitrate'];

export function getAllSettingsKeys() {
  const keys = [];
  for (const cat of Object.values(KEYS)) {
    for (const k of Object.values(cat)) {
      keys.push(k);
    }
  }
  for (let s = 1; s <= 4; s++) {
    for (const f of RELAY_FIELDS) {
      keys.push(relaySlotKey(s, f));
    }
  }
  return keys;
}

export function exportSettings() {
  const data = { version: 1, exported: new Date().toISOString(), settings: {} };
  for (const key of getAllSettingsKeys()) {
    try {
      const val = localStorage.getItem(key);
      if (val !== null) data.settings[key] = val;
    } catch {}
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('lcyt.broadcast.')) {
        data.settings[k] = localStorage.getItem(k);
      }
    }
  } catch {}
  return data;
}

export function downloadSettings() {
  const data = exportSettings();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lcyt-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importSettings(data) {
  if (!data || data.version !== 1 || typeof data.settings !== 'object') {
    return { ok: false, count: 0, errors: ['Invalid settings file format'] };
  }
  let count = 0;
  const errors = [];
  for (const [key, value] of Object.entries(data.settings)) {
    if (!key.startsWith('lcyt.')) {
      errors.push(`Skipped unknown key: ${key}`);
      continue;
    }
    try {
      localStorage.setItem(key, value);
      count++;
    } catch (e) {
      errors.push(`Failed to set ${key}: ${e.message}`);
    }
  }
  try { window.dispatchEvent(new Event('lcyt:settings-imported')); } catch {}
  return { ok: true, count, errors };
}
