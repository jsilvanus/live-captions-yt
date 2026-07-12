/**
 * RolesBus — SSE subscriber registry for agentic_chat role events
 * (tool_call_started, tool_call_result, reply, staged_action,
 * assistant_suggestion, assistant_action, tracker_update, describer_update).
 *
 * Delegates SSE bookkeeping to the shared EventBus (lcyt/event-bus). The bus is
 * keyed by project (apiKey); the role is carried in the canonical topic
 * `role.<roleCode>.<event>` so one role's stream stays isolated from another's
 * (each subscriber only matches its own `role.<roleCode>.*` prefix) without
 * leaking roleCode into the payload. External consumers can subscribe to
 * `role.*` (all roles) or `role.<roleCode>.*` on `/events/stream`.
 *
 * Role events are consumed from the unified `/events/stream` surface by
 * subscribing to `role.<roleCode>.*` topics.
 */
import { EventBus } from 'lcyt/event-bus';

export class RolesBus {
  /**
   * @param {import('lcyt/event-bus').EventBus} [eventBus] shared bus; a private
   *   one is created when omitted (keeps isolated tests standalone).
   */
  constructor(eventBus) {
    this._bus = eventBus ?? new EventBus();
    /** @type {Map<import('express').Response, () => void>} res -> unsubscribe */
    this._offByRes = new Map();
  }

  addSubscriber(apiKey, roleCode, res) {
    const prefix = `role.${roleCode}.`;
    const off = this._bus.subscribeSse(apiKey, [`${prefix}*`], res, {
      envelope: false,
      rename: (topic) => (topic.startsWith(prefix) ? topic.slice(prefix.length) : topic),
    });
    this._offByRes.set(res, off);
  }

  removeSubscriber(apiKey, roleCode, res) {
    const off = this._offByRes.get(res);
    if (off) {
      off();
      this._offByRes.delete(res);
    }
  }

  /**
   * @param {string} apiKey
   * @param {string} roleCode
   * @param {string} event
   * @param {object} data
   */
  emit(apiKey, roleCode, event, data) {
    this._bus.publish(apiKey, `role.${roleCode}.${event}`, data);
  }
}
