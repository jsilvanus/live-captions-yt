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
 * Sound-state cue listening:
 *   createSoundCueListener() subscribes to sound_label events on each
 *   session emitter and evaluates music_start/music_stop/silence rules.
 *
 * Usage:
 *   const cueProcessor = createCueProcessor({ store, db, engine });
 *   // In captions route:
 *   caption.text = cueProcessor(session.apiKey, caption.text || '', caption.codes);
 *
 *   // Wire sound events (call once after store is available):
 *   createSoundCueListener({ store, engine });
 */

import { insertCueEvent } from './db.js';

const CUE_RE = /<!--\s*cue\s*:\s*([^>]+?)\s*-->/gi;

/** Sentinel rule ID for explicit (metacode-triggered) cue events. */
const EXPLICIT_CUE_RULE_ID = '__explicit__';

/** Emit cue_fired SSE events for fired rules. */
function _emitCueResults(store, apiKey, fired) {
  if (!fired || fired.length === 0) return;
  const session = store?.getByApiKey?.(apiKey);
  if (!session?.emitter) return;
  const ts = Date.now();
  for (const { rule, matched } of fired) {
    let action = {};
    try { action = JSON.parse(rule.action); } catch { /* ignore */ }
    session.emitter.emit('event', {
      type: 'cue_fired',
      data: {
        label: rule.name,
        source: 'event_cue',
        ruleId: rule.id,
        matchType: rule.match_type,
        matched,
        action,
        ts,
      },
    });
  }
}

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

      // Evaluate event cue rules asynchronously via the AI agent.
      // This runs in the background — results arrive via SSE callback.
      engine.evaluateEventCues(apiKey, cleanText, (eventFired) => {
        _emitCueResults(store, apiKey, eventFired);
      }).catch(err => {
        console.warn('[cues] Event cue evaluation error:', err?.message);
      });
    }

    return cleanText;
  };
}

/**
 * Wire sound_label events from session emitters to the CueEngine.
 *
 * When the music plugin emits a sound_label event (music/speech/silence),
 * this listener evaluates music_start, music_stop, and silence cue rules.
 *
 * For silence rules: if silence persists for the configured minimum duration,
 * the cue fires. If the silence is broken, the timer is cancelled.
 *
 * Call once after the session store is available.
 *
 * @param {{ store: object, engine: import('./cue-engine.js').CueEngine }} opts
 */
export function createSoundCueListener({ store, engine }) {
  if (!store || !engine) return;

  // Hook into the store's session-creation lifecycle.
  // Each new session gets a listener on its emitter.
  const origOnSession = store.onNewSession;
  store.onNewSession = (session) => {
    origOnSession?.(session);
    _attachSoundListener(session, engine, store);
  };

  // Also attach to existing sessions
  for (const session of store.all?.() ?? []) {
    _attachSoundListener(session, engine, store);
  }
}

function _attachSoundListener(session, engine, store) {
  if (!session?.emitter || session._cueSoundListenerAttached) return;
  session._cueSoundListenerAttached = true;

  session.emitter.on('event', (evt) => {
    if (evt.type !== 'sound_label') return;
    const label = evt.data?.label;
    if (!label) return;

    // Evaluate music_start, music_stop, and silence rules
    const fired = engine.evaluateSoundEvent(session.apiKey, label, (delayedResults) => {
      // Silence timer callback — fire cue_fired events for the delayed results
      _emitCueFired(session, delayedResults);
    });

    // Emit immediately fired rules (music_start, music_stop)
    _emitCueFired(session, fired);
  });
}

function _emitCueFired(session, fired) {
  if (!fired || fired.length === 0 || !session?.emitter) return;
  const ts = Date.now();
  for (const { rule, matched } of fired) {
    let action = {};
    try { action = JSON.parse(rule.action); } catch { /* ignore */ }

    session.emitter.emit('event', {
      type: 'cue_fired',
      data: {
        label: rule.name,
        source: 'sound',
        ruleId: rule.id,
        matchType: rule.match_type,
        matched,
        action,
        ts,
      },
    });
  }
}
