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
 *   <!-- sound:music -->      audio is music
 *   <!-- sound:speech -->     audio is speech
 *   <!-- sound:silence -->    audio is silent
 *   <!-- bpm:128 -->          current BPM estimate (integer)
 *
 * Usage:
 *   const soundProcessor = createSoundCaptionProcessor({ store, db });
 *   // In captions route:
 *   caption.text = soundProcessor(session.apiKey, caption.text || '');
 */

import { insertMusicEvent } from './db.js';

const SOUND_RE = /<!--\s*sound\s*:\s*(music|speech|silence)\s*-->/gi;
const BPM_RE   = /<!--\s*bpm\s*:\s*(\d+)\s*-->/gi;

/**
 * @param {{ store: import('../../lcyt-backend/src/store.js').SessionStore|null, db: import('better-sqlite3').Database }} opts
 * @returns {(apiKey: string, text: string) => string}
 */
export function createSoundCaptionProcessor({ store, db }) {
  return function processSoundCaption(apiKey, text) {
    if (!text) return text;

    // Reset lastIndex for global regexes before each call
    SOUND_RE.lastIndex = 0;
    BPM_RE.lastIndex   = 0;

    const soundMatch = SOUND_RE.exec(text);
    SOUND_RE.lastIndex = 0;
    const bpmMatch   = BPM_RE.exec(text);
    BPM_RE.lastIndex   = 0;

    // Strip metacodes — always, even if there's no match (idempotent)
    const cleanText = text
      .replace(/<!--\s*sound\s*:\s*(music|speech|silence)\s*-->/gi, '')
      .replace(/<!--\s*bpm\s*:\s*\d+\s*-->/gi, '')
      .trim();

    if (!soundMatch && !bpmMatch) return cleanText;

    const label = soundMatch ? soundMatch[1].toLowerCase() : null;
    const bpm   = bpmMatch ? parseInt(bpmMatch[1], 10) : null;
    const ts    = Date.now();

    // Persist to DB
    if (db && label) {
      try {
        insertMusicEvent(db, apiKey, { event_type: 'label_change', label, bpm: bpm ?? null });
      } catch (err) {
        // Non-fatal — DB write failure should not block caption delivery
        console.warn('[music] Failed to insert music_event:', err?.message);
      }
    } else if (db && bpm != null) {
      try {
        insertMusicEvent(db, apiKey, { event_type: 'bpm_update', label: null, bpm });
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
          data: { label, bpm: bpm ?? null, confidence: null, ts },
        });
      }
      if (bpm != null) {
        session.emitter.emit('event', {
          type: 'bpm_update',
          data: { bpm, confidence: null, ts },
        });
      }
    }

    return cleanText;
  };
}
