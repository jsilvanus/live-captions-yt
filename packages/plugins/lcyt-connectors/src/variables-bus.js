/**
 * VariablesBus — variable change publisher for EventBus topics.
 *
 * Delegates SSE bookkeeping to the shared EventBus (lcyt/event-bus). Each change
 * is published as a per-variable topic `variable.<name>.changed` carrying the
 * serialized row (name, value, source, …) — so an external subscriber can watch
 * one variable (`variable.section.changed`), all variables (`variable.*`), or
 * receive the content of every change.
 */
import { EventBus } from 'lcyt/event-bus';

const VARIABLE_TOPIC_PREFIX = 'variable.';
const VARIABLE_EVENT = 'variable_updated';

/** Canonical per-variable topic for a change to `name`. */
export function variableTopic(name) {
  return `${VARIABLE_TOPIC_PREFIX}${name}.changed`;
}

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
    // Subscribe to every per-variable topic; re-emit the historical event name.
    const off = this._bus.subscribeSse(apiKey, ['variable.*'], res, {
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
    // Per-variable topic (variable.<name>.changed); the payload includes the value.
    if (data?.name) this._bus.publish(apiKey, variableTopic(data.name), data);
  }
}
