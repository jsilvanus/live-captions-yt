/**
 * Sound caption processor.
 *
 * Extracts <!-- sound:... --> and <!-- bpm:... --> metacodes from caption text,
 * fires sound_label / bpm_update SSE events on the session GET /events stream,
 * and persists events to the music_events DB table.
 *
 * The returned cleanText is always the original text with all metacodes stripped.
 * For pure-metacode captions this will be "" — nothing is delivered to YouTube.
 *
 * Analogous to createDskCaptionProcessor in lcyt-dsk.
 *
 * Metacode syntax:
 *   <!-- sound:music -->          audio is music
 *   <!-- sound:speech -->         audio is speech
 *   <!-- sound:silence -->        audio is silent
 *   <!-- sound:music:0.92 -->     audio is music, with an optional confidence value (0-1)
 *   <!-- bpm:128 -->              current BPM estimate (integer)
 *
 * If a caption contains more than one sound/bpm metacode (which should not
 * normally happen, but is not rejected), the last occurrence of each type wins
 * — this mirrors "most recent state in this caption" rather than silently
 * ignoring everything after the first match.
 *
 * Usage:
 *   const soundProcessor = createSoundCaptionProcessor({ store, db });
 *   // In captions route:
 *   caption.text = soundProcessor(session.apiKey, caption.text || '');
 */

import { insertMusicEvent } from './db.js';

const SOUND_PATTERN = /<!--\s*sound\s*:\s*(music|speech|silence)\s*(?::\s*([01](?:\.\d+)?)\s*)?-->/gi;
const BPM_PATTERN    = /<!--\s*bpm\s*:\s*(\d+)\s*-->/gi;

/**
 * @param {{ store: import('../../lcyt-backend/src/store.js').SessionStore|null, db: import('better-sqlite3').Database }} opts
 * @returns {(apiKey: string, text: string) => string}
 */
export function createSoundCaptionProcessor({ store, db }) {
  return function processSoundCaption(apiKey, text) {
    if (!text) return text;

    // matchAll() on a 'g' regex never mutates a shared lastIndex, so a fresh
    // matcher per call is unnecessary here — but we still take the LAST match
    // of each type as authoritative, in case a caption somehow carries more
    // than one of the same metacode.
    const soundMatches = [...text.matchAll(SOUND_PATTERN)];
    const bpmMatches    = [...text.matchAll(BPM_PATTERN)];
    const soundMatch = soundMatches.at(-1) ?? null;
    const bpmMatch   = bpmMatches.at(-1) ?? null;

    const cleanText = text.replace(SOUND_PATTERN, '').replace(BPM_PATTERN, '').trim();

    if (!soundMatch && !bpmMatch) return cleanText;

    const label      = soundMatch ? soundMatch[1].toLowerCase() : null;
    const confidence = soundMatch && soundMatch[2] != null ? Number(soundMatch[2]) : null;
    const bpm        = bpmMatch ? parseInt(bpmMatch[1], 10) : null;
    const ts         = Date.now();

    // Persist to DB. Write a separate row per event type so the DB log mirrors
    // the SSE events emitted below 1:1 (a caption carrying both a label and a
    // bpm value produces two rows, not one combined row).
    if (db && label) {
      try {
        insertMusicEvent(db, apiKey, { event_type: 'label_change', label, bpm: bpm ?? null, confidence });
      } catch (err) {
        // Non-fatal — DB write failure should not block caption delivery
        console.warn('[music] Failed to insert music_event:', err?.message);
      }
    }
    if (db && bpm != null) {
      try {
        insertMusicEvent(db, apiKey, { event_type: 'bpm_update', label: null, bpm, confidence });
      } catch (err) {
        console.warn('[music] Failed to insert music_event (bpm):', err?.message);
      }
    }

    // Emit SSE events on the existing session /events stream
    const session = store?.getByApiKey?.(apiKey);
    if (session?.emitter) {
      if (label) {
        session.emitter.emit('event', {
          type: 'sound_label',
          data: { label, bpm: bpm ?? null, confidence, ts },
        });
      }
      if (bpm != null) {
        session.emitter.emit('event', {
          type: 'bpm_update',
          data: { bpm, confidence, ts },
        });
      }
    }

    return cleanText;
  };
}
