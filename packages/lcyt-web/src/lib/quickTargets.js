/**
 * Pure helpers for the quick "Send captions to YouTube" page: the caption key the user pastes, and the
 * one YouTube entry in the browser's target list (`lib/targetConfig.js`). No React, so node tests can import this.
 */

/**
 * The caption key out of what the user pasted. YouTube Studio shows either the bare key or the whole POST URL
 * (`http://upload.youtube.com/closedcaption?cid=XXXX-XXXX-XXXX-XXXX`); both are accepted.
 * @param {string} input
 * @returns {string} the key, or '' when nothing usable was given
 */
export function parseCaptionKey(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const cid = text.match(/[?&]cid=([^&\s#]+)/i);
  if (cid) return decodeURIComponent(cid[1]);
  if (/^https?:\/\//i.test(text)) return '';
  return /\s/.test(text) ? '' : text;
}

/** `••••AB12`: enough to recognise a key, never the whole of it. */
export function maskKey(key) {
  const k = String(key || '').trim();
  return k ? `••••${k.slice(-4)}` : '';
}

/** The first YouTube target of a target list, or null. */
export function findYoutubeTarget(list) {
  return (list || []).find(t => t && t.type === 'youtube') || null;
}

/**
 * The target list with the YouTube target set to `key` and switched on. An existing YouTube target keeps its id
 * and other settings; without one a new target is added. Other targets are left as they are.
 * @param {Array<object>} list
 * @param {string} key
 * @param {() => string} newId
 */
export function withYoutubeKey(list, key, newId) {
  const current = list || [];
  const existing = findYoutubeTarget(current);
  if (!existing) return [...current, { id: newId(), enabled: true, type: 'youtube', streamKey: key }];
  return current.map(t => (t === existing ? { ...t, streamKey: key, enabled: true } : t));
}

/** The target list without its YouTube target. */
export function withoutYoutubeTarget(list) {
  const existing = findYoutubeTarget(list);
  return (list || []).filter(t => t !== existing);
}

/** Id for a new target: a UUID where the browser has one. */
export function newTargetId() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* fall through */ }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** BCP-47 tag as the browser engines use it (`fi-FI`) to the short code the auditor service takes (`fi`). */
export function auditorLanguage(tag) {
  return String(tag || '').split('-')[0].toLowerCase();
}
