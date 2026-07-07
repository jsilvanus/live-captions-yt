/**
 * RolesBus — SSE subscriber registry for agentic_chat role events
 * (tool_call_started, tool_call_result, reply, staged_action,
 * assistant_suggestion, assistant_action).
 *
 * Mirrors packages/lcyt-connectors/src/variables-bus.js's shape: per-key
 * subscriber sets, dead connections pruned on write failure. Keyed by
 * `${apiKey}:${roleCode}` so one apiKey's Setup Assistant stream doesn't
 * receive another role's events.
 */
export class RolesBus {
  constructor() {
    /** @type {Map<string, Set<import('express').Response>>} */
    this._subscribers = new Map();
  }

  _key(apiKey, roleCode) {
    return `${apiKey}:${roleCode}`;
  }

  addSubscriber(apiKey, roleCode, res) {
    const key = this._key(apiKey, roleCode);
    if (!this._subscribers.has(key)) this._subscribers.set(key, new Set());
    this._subscribers.get(key).add(res);
  }

  removeSubscriber(apiKey, roleCode, res) {
    const key = this._key(apiKey, roleCode);
    const set = this._subscribers.get(key);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this._subscribers.delete(key);
  }

  /**
   * @param {string} apiKey
   * @param {string} roleCode
   * @param {string} event
   * @param {object} data
   */
  emit(apiKey, roleCode, event, data) {
    const key = this._key(apiKey, roleCode);
    const set = this._subscribers.get(key);
    if (!set || set.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...set]) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
    if (set.size === 0) this._subscribers.delete(key);
  }
}
