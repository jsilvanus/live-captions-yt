/**
 * Cue caption processor.
 *
 * Strips <!-- cue:... --> metacodes from caption text and evaluates
 * incoming captions against CueEngine rules (phrase/regex/section).
 * Fires cue_fired SSE events on the session GET /events stream.
 *
 * The returned cleanText is always the original text with all cue metacodes
 * stripped.  For pure-metacode captions this will be "" — nothing is
 * delivered to YouTube.
 *
 * Cue Engine flow:
 *   1. <!-- cue:phrase --> in a rundown FILE defines a cue trigger point.
 *      The frontend parser creates a cue entry at that line position.
 *   2. When live captions pass through this processor, the CueEngine
 *      matches against registered rules (DB or session-scoped) and fires
 *      cue_fired SSE events.
 *   3. The frontend receives cue_fired events and jumps the file pointer
 *      to the matching cue line.
 *
 * If a <!-- cue:label --> metacode appears directly in outgoing caption
 * text it is stripped and a cue_fired event is emitted so the frontend
 * can react (explicit trigger).
 *
 * Usage:
 *   const cueProcessor = createCueProcessor({ store, db, engine });
 *   // In captions route:
 *   caption.text = cueProcessor(session.apiKey, caption.text || '', caption.codes);
 */

import { insertCueEvent } from './db.js';

const CUE_RE = /<!--\s*cue\s*:\s*([^>]+?)\s*-->/gi;

/** Sentinel rule ID for explicit (metacode-triggered) cue events. */
const EXPLICIT_CUE_RULE_ID = '__explicit__';

/**
 * @param {{ store: object|null, db: import('better-sqlite3').Database, engine: import('./cue-engine.js').CueEngine }} opts
 * @returns {(apiKey: string, text: string, codes?: object) => string}
 */
export function createCueProcessor({ store, db, engine }) {
  return function processCueCaption(apiKey, text, codes = {}) {
    if (!text && (!codes || Object.keys(codes).length === 0)) return text || '';

    // Reset lastIndex for global regex before each call
    CUE_RE.lastIndex = 0;

    // Extract explicit <!-- cue:... --> metacodes
    const explicitCues = [];
    let match;
    while ((match = CUE_RE.exec(text || '')) !== null) {
      explicitCues.push(match[1].trim());
    }
    CUE_RE.lastIndex = 0;

    // Strip cue metacodes from text — reuse CUE_RE pattern
    CUE_RE.lastIndex = 0;
    const cleanText = (text || '')
      .replace(CUE_RE, '')
      .trim();

    const ts = Date.now();

    // Fire explicit cue events
    for (const label of explicitCues) {
      // Persist to DB
      if (db) {
        try {
          insertCueEvent(db, apiKey, {
            rule_id: EXPLICIT_CUE_RULE_ID,
            rule_name: label,
            matched: label,
            action: { type: 'event', label },
          });
        } catch (err) {
          console.warn('[cues] Failed to insert explicit cue_event:', err?.message);
        }
      }

      // Emit SSE event
      const session = store?.getByApiKey?.(apiKey);
      if (session?.emitter) {
        session.emitter.emit('event', {
          type: 'cue_fired',
          data: { label, source: 'explicit', matched: label, ts },
        });
      }
    }

    // Evaluate automatic rules from the CueEngine
    if (engine) {
      const fired = engine.evaluate(apiKey, cleanText, codes);
      for (const { rule, matched } of fired) {
        let action = {};
        try { action = JSON.parse(rule.action); } catch { /* ignore */ }

        const session = store?.getByApiKey?.(apiKey);
        if (session?.emitter) {
          session.emitter.emit('event', {
            type: 'cue_fired',
            data: {
              label: rule.name,
              source: 'auto',
              ruleId: rule.id,
              matchType: rule.match_type,
              matched,
              action,
              ts,
            },
          });
        }
      }
    }

    return cleanText;
  };
}
