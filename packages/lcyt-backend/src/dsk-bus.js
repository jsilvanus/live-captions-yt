/**
 * DskBus — DSK graphics SSE subscriber registry and per-key graphics state.
 *
 * The SSE subscriber/broadcast bookkeeping is now delegated to the shared
 * EventBus (lcyt/event-bus): `addDskSubscriber`/`emitDskEvent` register/publish
 * through it, so DSK events also reach the unified `/events/stream` endpoint and
 * any in-process listeners. The public method signatures are unchanged, and the
 * bespoke `GET /dsk/:apikey/events` stream keeps its exact historical wire shape
 * (legacy `event:` names, raw `data`) via the `rename`/`envelope:false` options.
 *
 * The per-key graphics state (used for delta +/- operations) is DSK-specific and
 * stays here — it is not SSE plumbing.
 *
 * API surface consumed by lcyt-dsk:
 *   addDskSubscriber(apiKey, res)
 *   removeDskSubscriber(apiKey, res)
 *   emitDskEvent(apiKey, eventName, data)
 *   getDskGraphicsState(apiKey)
 *   setDskGraphicsState(apiKey, state)
 */
import { EventBus } from 'lcyt/event-bus';

/** Legacy DSK event name -> canonical bus topic. */
const DSK_TOPIC_FOR = {
  graphics: 'dsk.graphics_changed',
  text: 'dsk.text',
  bindings: 'dsk.bindings',
  templates: 'dsk.templates_changed',
  layer_update: 'dsk.layer_updated',
};
/** Canonical bus topic -> legacy DSK event name (inverse of above). */
const DSK_EVENT_FOR = Object.fromEntries(
  Object.entries(DSK_TOPIC_FOR).map(([event, topic]) => [topic, event]),
);
const DSK_TOPICS = Object.values(DSK_TOPIC_FOR);

export class DskBus {
  /**
   * @param {import('lcyt/event-bus').EventBus} [eventBus] shared bus; a private
   *   one is created when omitted (keeps isolated tests standalone).
   */
  constructor(eventBus) {
    this._bus = eventBus ?? new EventBus();
    /** @type {Map<import('express').Response, () => void>} res -> unsubscribe */
    this._offByRes = new Map();
    /**
     * Server-side active graphics state for delta +/- operations.
     * @type {Map<string, { default: string[], viewports: { [name]: string[] } }>}
     */
    this._graphicsState = new Map();
  }

  /**
   * Register an SSE response as a subscriber for an API key. The DSK page keeps
   * seeing its historical event names (`graphics`/`text`/`bindings`/`templates`/
   * `layer_update`) carrying the raw payload — byte-identical to before.
   * @param {string} apiKey
   * @param {import('express').Response} res
   */
  addDskSubscriber(apiKey, res) {
    const off = this._bus.subscribeSse(apiKey, DSK_TOPICS, res, {
      envelope: false,
      rename: (topic) => DSK_EVENT_FOR[topic] ?? topic,
    });
    this._offByRes.set(res, off);
  }

  /**
   * Unregister a subscriber.
   * @param {string} apiKey
   * @param {import('express').Response} res
   */
  removeDskSubscriber(apiKey, res) {
    const off = this._offByRes.get(res);
    if (off) {
      off();
      this._offByRes.delete(res);
    }
  }

  /**
   * Emit a DSK SSE event to all subscribers for an API key. Publishes the
   * canonical topic; dead connections are pruned by the bus.
   * @param {string} apiKey
   * @param {string} eventName  legacy DSK event name
   * @param {object} data       JSON-serialisable payload
   */
  emitDskEvent(apiKey, eventName, data) {
    this._bus.publish(apiKey, DSK_TOPIC_FOR[eventName] ?? `dsk.${eventName}`, data);
  }

  /**
   * Get the current graphics state for an API key.
   * Creates an empty state if none exists yet.
   * @param {string} apiKey
   * @returns {{ default: string[], viewports: { [name]: string[] } }}
   */
  getDskGraphicsState(apiKey) {
    if (!this._graphicsState.has(apiKey)) {
      this._graphicsState.set(apiKey, { default: [], viewports: {} });
    }
    return this._graphicsState.get(apiKey);
  }

  /**
   * Persist updated graphics state for an API key.
   * @param {string} apiKey
   * @param {{ default: string[], viewports: { [name]: string[] } }} state
   */
  setDskGraphicsState(apiKey, state) {
    this._graphicsState.set(apiKey, state);
  }
}
