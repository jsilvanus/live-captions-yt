/**
 * VariablesBus — SSE subscriber registry for variable_updated events.
 *
 * Mirrors packages/lcyt-backend/src/dsk-bus.js's shape: per-API-key subscriber
 * sets, dead connections pruned on write failure.
 */
export class VariablesBus {
  constructor() {
    /** @type {Map<string, Set<import('express').Response>>} */
    this._subscribers = new Map();
  }

  addSubscriber(apiKey, res) {
    if (!this._subscribers.has(apiKey)) this._subscribers.set(apiKey, new Set());
    this._subscribers.get(apiKey).add(res);
  }

  removeSubscriber(apiKey, res) {
    const set = this._subscribers.get(apiKey);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this._subscribers.delete(apiKey);
  }

  /**
   * @param {string} apiKey
   * @param {{ name: string, value: string, source: string, resolvedAt: string|null }} data
   */
  emitVariableUpdated(apiKey, data) {
    const set = this._subscribers.get(apiKey);
    if (!set || set.size === 0) return;
    const payload = `event: variable_updated\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...set]) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
    if (set.size === 0) this._subscribers.delete(apiKey);
  }
}
