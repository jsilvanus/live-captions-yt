/**
 * Pure helpers for the quick "Send broadcast to multiple targets" page: an output is one relay slot
 * (`POST/PUT/DELETE /stream`) that sends the incoming stream to a YouTube key or any rtmp(s) URL.
 * No React, so node tests can import this.
 */

export const YOUTUBE_RTMP_URL = 'rtmp://a.rtmp.youtube.com/live2';

export const EMPTY_OUTPUT_FORM = Object.freeze({ type: 'youtube', youtubeKey: '', url: '', name: '' });

/** A pasted YouTube stream key; an rtmp URL ending in the key is accepted and cut down to the key. */
export function parseStreamKey(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  if (/^rtmps?:\/\//i.test(text)) {
    const last = text.replace(/\/+$/, '').split('/').pop();
    return /^[\w-]+$/.test(last) && !/^live2?$/i.test(last) ? last : '';
  }
  return /\s/.test(text) ? '' : text;
}

export function isRtmpUrl(url) {
  return /^rtmps?:\/\/[^\s/]+(\/\S*)?$/i.test(String(url || '').trim());
}

/**
 * @param {{ type: 'youtube'|'generic', youtubeKey?: string, url?: string, name?: string }} form
 * @returns {string|null} a `quick.restream.err.*` key, or null when the form can be saved
 */
export function outputFormError(form) {
  if (form.type === 'youtube') return parseStreamKey(form.youtubeKey) ? null : 'noKey';
  return isRtmpUrl(form.url) ? null : 'badUrl';
}

/** Request body for POST/PUT /stream. A new output has no `slot`, so the server appends it. */
export function outputBody(form, slot) {
  const body = form.type === 'youtube'
    ? { targetUrl: YOUTUBE_RTMP_URL, targetName: parseStreamKey(form.youtubeKey), captionMode: 'http' }
    : { targetUrl: form.url.trim(), targetName: (form.name || '').trim() || null, captionMode: 'http' };
  if (slot != null) body.slot = slot;
  return body;
}

/** The form that shows a relay slot (inverse of outputBody). */
export function formFromRelay(relay) {
  if (relay.targetUrl === YOUTUBE_RTMP_URL) return { type: 'youtube', youtubeKey: relay.targetName || '', url: '', name: '' };
  return { type: 'generic', youtubeKey: '', url: relay.targetUrl || '', name: relay.targetName || '' };
}

export function isYoutubeRelay(relay) {
  return relay.targetUrl === YOUTUBE_RTMP_URL;
}

/** Row detail: a YouTube key is masked, a generic URL is shown without the secret path part after the host. */
export function relayDetail(relay) {
  if (isYoutubeRelay(relay)) return relay.targetName ? `••••${relay.targetName.slice(-4)}` : '';
  try {
    const u = new URL(relay.targetUrl);
    return `${u.protocol}//${u.host}${u.pathname.length > 1 ? '/…' : ''}`;
  } catch { return ''; }
}

/** Relay slots in slot order. */
export function sortedRelays(relays) {
  return [...(relays || [])].sort((a, b) => a.slot - b.slot);
}

/**
 * What the page says about the relay as a whole.
 * `off`: switched off. `waiting`: on, but nothing is arriving. `running`: on and at least one output is sending.
 * `stalled`: on, the stream is arriving, but no output runs (check the outputs).
 * @param {{ active: boolean, runningSlots: number[] }} relay
 * @param {boolean|null|undefined} incomingLive
 */
export function relayState(relay, incomingLive) {
  if (!relay?.active) return 'off';
  if ((relay.runningSlots || []).length > 0) return 'running';
  return incomingLive ? 'stalled' : 'waiting';
}

/**
 * `rtmp://host/app/key` as the two parts an encoder asks for: server `rtmp://host/app` and key `key`.
 * @param {string} url
 * @returns {{ server: string, key: string }}
 */
export function splitIngestUrl(url) {
  const text = String(url || '').trim().replace(/\/+$/, '');
  const cut = text.lastIndexOf('/');
  if (cut < 0 || /^rtmps?:\/\/[^/]*$/i.test(text)) return { server: text, key: '' };
  return { server: text.slice(0, cut), key: text.slice(cut + 1) };
}
