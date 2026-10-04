/**
 * Cue caption processor.
 *
 * Strips <!-- cue:... --> metacodes from caption text and evaluates
 * incoming captions against CueEngine rules (phrase/regex/section).
 * Fires cue_fired SSE events on the session GET /events stream and publishes
 * the canonical `cue.fired` topic on the EventBus (with or without a session).
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
 * Tracker-state cue listening (Phase 9):
 *   createTrackerCueListener() mirrors createSoundCueListener() for
 *   track_state events and evaluates match_type: 'track' rules.
 *
 * Usage:
 *   const cueProcessor = createCueProcessor({ store, db, engine, eventBus });
 *   // In captions route:
 *   caption.text = cueProcessor(session.apiKey, caption.text || '', caption.codes);
 *
 *   // Wire sound events (call once after store is available):
 *   createSoundCueListener({ store, engine, eventBus });
 */

import { insertCueEvent } from './db.js';
import logger from 'lcyt/logger';

const CUE_RE = /<!--\s*cue\s*:\s*([^>]+?)\s*-->/gi;

/** Sentinel rule ID for explicit (metacode-triggered) cue events. */
const EXPLICIT_CUE_RULE_ID = '__explicit__';

/**
 * Build the one function every cue-firing site goes through.
 *
 * A fired cue is delivered two ways: (1) the legacy per-session SSE event
 * `cue_fired` on the session emitter (store.js re-publishes that on the bus as
 * `plugin.cue_fired`), which only exists while a caption session is open, and
 * (2) the canonical `cue.fired` topic published straight on the EventBus
 * under the project's apiKey, which works with or without a session. The
 * event catalog, MCP token scopes, the audit allowlist and the Hosted Operator
 * all subscribe to `cue.fired`; before this it was never published.
 *
 * @param {{ store?: object|null, eventBus?: import('lcyt/event-bus').EventBus|null }} opts
 * @returns {(apiKey: string, data: object, session?: object|null) => void}
 */
export function createCueEmitter({ store = null, eventBus = null } = {}) {
  return function emitCueFired(apiKey, data, session = store?.getByApiKey?.(apiKey)) {
    if (session?.emitter) {
      session.emitter.emit('event', { type: 'cue_fired', data });
    }
    if (eventBus && apiKey) {
      try {
        eventBus.publish(apiKey, 'cue.fired', data);
      } catch (err) {
        logger.warn('[cues] Failed to publish cue.fired:', err?.message);
      }
    }
  };
}

/** Emit cue_fired events for fired rules (event/inline/composite results). */
function _emitCueResults(emitCueFired, apiKey, fired) {
  if (!fired || fired.length === 0) return;
  const ts = Date.now();
  for (const { rule, matched } of fired) {
    let action = {};
    try { action = JSON.parse(rule.action); } catch { /* ignore */ }
    emitCueFired(apiKey, {
      label: rule.name,
      source: rule.source === 'inline' ? 'inline' : (rule.match_type === 'composite' ? 'composite' : 'event_cue'),
      ruleId: rule.id,
      matchType: rule.match_type,
      matched,
      action,
      ts,
    });
  }
}

/**
 * @param {{ store: object|null, db: import('better-sqlite3').Database, engine: import('./cue-engine.js').CueEngine, eventBus?: import('lcyt/event-bus').EventBus|null }} opts
 * @returns {(apiKey: string, text: string, codes?: object) => string}
 */
export function createCueProcessor({ store, db, engine, eventBus = null }) {
  const emitCueFired = createCueEmitter({ store, eventBus });
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

      // Emit SSE event + bus topic
      emitCueFired(apiKey, { label, source: 'explicit', matched: label, ts });
    }

    // Evaluate automatic rules from the CueEngine
    if (engine) {
      const fired = engine.evaluate(apiKey, cleanText, codes);
      for (const { rule, matched } of fired) {
        let action = {};
        try { action = JSON.parse(rule.action); } catch { /* ignore */ }

        emitCueFired(apiKey, {
          label: rule.name,
          source: 'auto',
          ruleId: rule.id,
          matchType: rule.match_type,
          matched,
          action,
          ts,
        });
      }

      // Evaluate inline cues from the active rundown file and DB-backed event cues.
      // These run in the background — results arrive via SSE callback.
      if (typeof engine.evaluateInlineCues === 'function') {
        void engine.evaluateInlineCues(apiKey, cleanText, codes, (eventFired) => {
          _emitCueResults(emitCueFired, apiKey, eventFired);
        }).catch(err => {
          console.warn('[cues] Inline cue evaluation error:', err?.message);
        });
      }

      if (typeof engine.evaluateEventCues === 'function') {
        engine.evaluateEventCues(apiKey, cleanText, (eventFired) => {
          _emitCueResults(emitCueFired, apiKey, eventFired);
        }).catch(err => {
          console.warn('[cues] Event cue evaluation error:', err?.message);
        });
      }

      // Evaluate DB-backed composite rules (Phase 9). Async — results arrive via SSE callback.
      if (typeof engine.evaluateCompositeRules === 'function') {
        engine.evaluateCompositeRules(apiKey, cleanText, codes, (eventFired) => {
          _emitCueResults(emitCueFired, apiKey, eventFired);
        }).catch(err => {
          logger.warn('[cues] Composite rule evaluation error:', err?.message);
        });
      }
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
export function createSoundCueListener({ store, engine, eventBus = null }) {
  if (!store || !engine) return;
  const emitCueFired = createCueEmitter({ store, eventBus });

  // Hook into the store's session-creation lifecycle.
  // Each new session gets a listener on its emitter.
  const origOnSession = store.onNewSession;
  store.onNewSession = (session) => {
    origOnSession?.(session);
    _attachSoundListener(session, engine, emitCueFired);
  };

  // Also attach to existing sessions
  for (const session of store.all?.() ?? []) {
    _attachSoundListener(session, engine, emitCueFired);
  }
}

function _attachSoundListener(session, engine, emitCueFired) {
  if (!session?.emitter || session._cueSoundListenerAttached) return;
  session._cueSoundListenerAttached = true;

  session.emitter.on('event', (evt) => {
    if (evt.type !== 'sound_label') return;
    const label = evt.data?.label;
    if (!label) return;

    // Evaluate music_start, music_stop, and silence rules
    const fired = engine.evaluateSoundEvent(session.apiKey, label, (delayedResults) => {
      // Silence timer callback — fire cue_fired events for the delayed results
      _emitCueFired(emitCueFired, session, delayedResults, 'sound');
    });

    // Emit immediately fired rules (music_start, music_stop)
    _emitCueFired(emitCueFired, session, fired, 'sound');
  });
}

/**
 * Wire `track_state` events from session emitters to the CueEngine (Phase 9).
 *
 * Mirrors createSoundCueListener() exactly, but for `track:` cue rules: a fast
 * local tracker subsystem (out of scope for this plugin — see plan_cues.md
 * Phase 9 "Tracker-state leaves") emits `track_state` events shaped like
 * `{ labels: [{ label, confidence, region? }], ts }` on the session emitter,
 * the same way lcyt-music emits `sound_label`. Producer:
 * `packages/lcyt-backend/src/perception-aggregator.js` (plan_video_perception.md
 * Phase 2), fed by dedicated-feed cameras only so far — Phase 3's shared-feed
 * resolver is the only other planned producer of this event.
 *
 * Call once after the session store is available.
 *
 * @param {{ store: object, engine: import('./cue-engine.js').CueEngine }} opts
 */
export function createTrackerCueListener({ store, engine, eventBus = null }) {
  if (!store || !engine) return;
  const emitCueFired = createCueEmitter({ store, eventBus });

  const origOnSession = store.onNewSession;
  store.onNewSession = (session) => {
    origOnSession?.(session);
    _attachTrackerListener(session, engine, emitCueFired);
  };

  for (const session of store.all?.() ?? []) {
    _attachTrackerListener(session, engine, emitCueFired);
  }
}

function _attachTrackerListener(session, engine, emitCueFired) {
  if (!session?.emitter || session._cueTrackerListenerAttached) return;
  session._cueTrackerListenerAttached = true;

  session.emitter.on('event', (evt) => {
    if (evt.type !== 'track_state') return;
    const state = evt.data;
    if (!state) return;

    const fired = engine.evaluateTrackerEvent(session.apiKey, state);
    _emitCueFired(emitCueFired, session, fired, 'track');
  });
}

function _emitCueFired(emitCueFired, session, fired, source = 'sound') {
  if (!fired || fired.length === 0 || !session) return;
  const ts = Date.now();
  for (const { rule, matched } of fired) {
    let action = {};
    try { action = JSON.parse(rule.action); } catch { /* ignore */ }

    emitCueFired(session.apiKey, {
      label: rule.name,
      source,
      ruleId: rule.id,
      matchType: rule.match_type,
      matched,
      action,
      ts,
    }, session);
  }
}
