/**
 * EventBus — one topic-based pub/sub layer for the whole backend.
 *
 * Generalizes the four near-identical per-project SSE subscriber registries that
 * grew independently (DskBus, VariablesBus, RolesBus, and the per-session
 * EventEmitter) into a single mechanism that works both:
 *   - over SSE   (subscribeSse) — same Map<projectId, Set<...>> + write-with-
 *     prune-on-failure bookkeeping every one of those buses reimplemented, and
 *   - in-process (subscribe)    — plugins reacting to each other's events
 *     without an HTTP round-trip or polling.
 *
 * Publishers call `publish(projectId, topic, data)`. Topics are namespaced
 * `<domain>.<event>` strings (e.g. `dsk.graphics_changed`, `variable.updated`,
 * `cue.fired`). Every legacy bus becomes a thin wrapper that publishes canonical
 * topics here while its bespoke HTTP endpoint re-emits under its historical
 * `event:` name (see the `rename`/`envelope` subscribe options) — so no existing
 * SSE client sees a wire-shape change.
 *
 * Lives in the core `lcyt` package (exported as `lcyt/event-bus`) rather than in
 * lcyt-backend so both lcyt-backend and the plugins (lcyt-connectors, lcyt-agent,
 * lcyt-dsk) can import it — plugins cannot depend on lcyt-backend, which depends
 * on them. It has no hard Express dependency; it only duck-types `res.write`.
 *
 * See docs/plans/plan_pubsub_event_bus.md.
 */
import logger from './logger.js';

/**
 * Does `topic` match any of `patterns`?
 *  - null / empty patterns  => match everything (subscribe-to-all)
 *  - exact string match     => `dsk.graphics_changed`
 *  - bare `*`               => everything
 *  - suffix wildcard `d.*`  => any topic starting with `d.`
 * @param {string[]|null|undefined} patterns
 * @param {string} topic
 * @returns {boolean}
 */
export function topicMatches(patterns, topic) {
  if (!patterns || patterns.length === 0) return true;
  for (const p of patterns) {
    if (p === '*' || p === topic) return true;
    if (p.endsWith('.*') && topic.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<{ res: import('express').Response, topics: string[]|null, rename: ((t:string)=>string)|null, envelope: boolean, filter: ((e:object)=>boolean)|null }>>} */
    this._subscribers = new Map();
    /** @type {Map<string, Set<{ topics: string[]|null, handler: (e:object)=>void }>>} */
    this._listeners = new Map();
    /** @type {Set<(e:object)=>void>} global taps — called for every publish across all projects (audit log). */
    this._taps = new Set();
  }

  /**
   * Publish an event. Delivers to matching SSE subscribers (pruning dead
   * connections on write failure), matching in-process listeners (each isolated
   * so one throwing handler can't break delivery to the rest), and every global
   * tap (used by the audit sink).
   * @param {string} projectId
   * @param {string} topic
   * @param {object} data  JSON-serialisable payload
   * @param {object} [meta]  extra envelope-level fields (e.g. `{ sessionId }`) —
   *   merged onto the envelope, NOT into `data`, so a subscriber can filter on
   *   them without changing the payload a legacy client sees. Core fields
   *   (topic/projectId/ts/data) always win over meta.
   */
  publish(projectId, topic, data, meta = null) {
    const envelope = { ...(meta || {}), topic, projectId, ts: Date.now(), data };

    const subs = this._subscribers.get(projectId);
    if (subs && subs.size > 0) {
      for (const sub of [...subs]) {
        if (!topicMatches(sub.topics, topic)) continue;
        if (sub.filter && !sub.filter(envelope)) continue;
        try {
          sub.res.write(this._frame(sub, envelope));
        } catch {
          subs.delete(sub);
        }
      }
      if (subs.size === 0) this._subscribers.delete(projectId);
    }

    const listeners = this._listeners.get(projectId);
    if (listeners) {
      for (const l of listeners) {
        if (!topicMatches(l.topics, topic)) continue;
        try {
          l.handler(envelope);
        } catch (err) {
          logger.error(`[event-bus] in-process listener for ${topic} threw: ${err?.message ?? err}`);
        }
      }
    }

    for (const tap of this._taps) {
      try {
        tap(envelope);
      } catch (err) {
        logger.error(`[event-bus] tap threw for ${topic}: ${err?.message ?? err}`);
      }
    }
  }

  /**
   * Build the SSE frame for one subscriber. Default frame carries the full
   * envelope under the topic name; legacy wrappers pass `envelope:false` (send
   * only the raw `data`, matching today's bespoke buses byte-for-byte) and/or a
   * `rename` mapping the canonical topic back to a historical `event:` name.
   * @private
   */
  _frame(sub, envelope) {
    const eventName = sub.rename ? sub.rename(envelope.topic) ?? envelope.topic : envelope.topic;
    const body = sub.envelope === false ? envelope.data : envelope;
    return `event: ${eventName}\ndata: ${JSON.stringify(body)}\n\n`;
  }

  /**
   * Register an SSE response as a subscriber for one project.
   * @param {string} projectId
   * @param {string[]|null} topics  topic patterns (see topicMatches); null = all
   * @param {import('express').Response} res
   * @param {object} [opts]
   * @param {(topic:string)=>string} [opts.rename]  map canonical topic -> emitted event name
   * @param {boolean} [opts.envelope=true]  false = write raw `data` instead of the full envelope
   * @param {(envelope:object)=>boolean} [opts.filter]  extra per-event predicate (e.g. roleCode match)
   * @returns {() => void} unsubscribe
   */
  subscribeSse(projectId, topics, res, { rename = null, envelope = true, filter = null } = {}) {
    const sub = { res, topics: topics ?? null, rename, envelope, filter };
    if (!this._subscribers.has(projectId)) this._subscribers.set(projectId, new Set());
    this._subscribers.get(projectId).add(sub);
    return () => {
      const set = this._subscribers.get(projectId);
      if (!set) return;
      set.delete(sub);
      if (set.size === 0) this._subscribers.delete(projectId);
    };
  }

  /** Total open SSE subscriptions across all projects (metrics gauge). */
  sseSubscriberCount() {
    let total = 0;
    for (const set of this._subscribers.values()) total += set.size;
    return total;
  }

  /**
   * Register an in-process listener for one project. No HTTP — this is how a
   * plugin reacts to another plugin's events. The handler receives the full
   * envelope `{ topic, projectId, ts, data }`.
   * @param {string} projectId
   * @param {string[]|null} topics  topic patterns; null = all
   * @param {(envelope:object)=>void} handler
   * @returns {() => void} unsubscribe
   */
  subscribe(projectId, topics, handler) {
    const listener = { topics: topics ?? null, handler };
    if (!this._listeners.has(projectId)) this._listeners.set(projectId, new Set());
    this._listeners.get(projectId).add(listener);
    return () => {
      const set = this._listeners.get(projectId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this._listeners.delete(projectId);
    };
  }

  /**
   * Register a global tap called on every publish across all projects, with the
   * full envelope. Used by the audit sink, which owns its own curated-topic
   * allowlist — the bus stays policy-free.
   * @param {(envelope:object)=>void} fn
   * @returns {() => void} unregister
   */
  tap(fn) {
    this._taps.add(fn);
    return () => this._taps.delete(fn);
  }
}
