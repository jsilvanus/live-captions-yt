/**
 * VariablesBus — SSE subscriber registry for variable_updated events.
 *
 * Delegates SSE bookkeeping to the shared EventBus (lcyt/event-bus): variables
 * publish the canonical `variable.updated` topic, so they also reach the unified
 * `/events/stream` endpoint and in-process listeners. The bespoke
 * `GET /variables/events` stream keeps its exact historical wire shape — a
 * `variable_updated` event carrying the raw serialized row — via the
 * `rename`/`envelope:false` options. Public method signatures are unchanged.
 */
import { EventBus } from 'lcyt/event-bus';

const VARIABLE_TOPIC = 'variable.updated';
const VARIABLE_EVENT = 'variable_updated';

export class VariablesBus {
  /**
   * @param {import('lcyt/event-bus').EventBus} [eventBus] shared bus; a private
   *   one is created when omitted (keeps isolated tests standalone).
   */
  constructor(eventBus) {
    this._bus = eventBus ?? new EventBus();
    /** @type {Map<import('express').Response, () => void>} res -> unsubscribe */
    this._offByRes = new Map();
  }

  addSubscriber(apiKey, res) {
    const off = this._bus.subscribeSse(apiKey, [VARIABLE_TOPIC], res, {
      envelope: false,
      rename: () => VARIABLE_EVENT,
    });
    this._offByRes.set(res, off);
  }

  removeSubscriber(apiKey, res) {
    const off = this._offByRes.get(res);
    if (off) {
      off();
      this._offByRes.delete(res);
    }
  }

  /**
   * @param {string} apiKey
   * @param {{ name: string, value: string, source: string, resolvedAt: string|null }} data
   */
  emitVariableUpdated(apiKey, data) {
    this._bus.publish(apiKey, VARIABLE_TOPIC, data);
  }
}
