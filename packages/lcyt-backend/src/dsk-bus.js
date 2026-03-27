/**
 * DskBus — DSK graphics SSE subscriber registry and per-key graphics state.
 *
 * Extracted from SessionStore so the DSK plugin (lcyt-dsk) does not depend on
 * the session lifecycle. Both lcyt-backend and lcyt-dsk receive the same DskBus
 * instance via dependency injection.
 *
 * API surface consumed by lcyt-dsk:
 *   addDskSubscriber(apiKey, res)
 *   removeDskSubscriber(apiKey, res)
 *   emitDskEvent(apiKey, eventName, data)
 *   getDskGraphicsState(apiKey)
 *   setDskGraphicsState(apiKey, state)
 */
export class DskBus {
  constructor() {
    /** @type {Map<string, Set<import('express').Response>>} */
    this._subscribers = new Map();
    /**
     * Server-side active graphics state for delta +/- operations.
     * @type {Map<string, { default: string[], viewports: { [name]: string[] } }>}
     */
    this._graphicsState = new Map();
  }

  /**
   * Register an SSE response as a subscriber for an API key.
   * @param {string} apiKey
   * @param {import('express').Response} res
   */
  addDskSubscriber(apiKey, res) {
    if (!this._subscribers.has(apiKey)) this._subscribers.set(apiKey, new Set());
    this._subscribers.get(apiKey).add(res);
  }

  /**
   * Unregister a subscriber.
   * @param {string} apiKey
   * @param {import('express').Response} res
   */
  removeDskSubscriber(apiKey, res) {
    const set = this._subscribers.get(apiKey);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this._subscribers.delete(apiKey);
  }

  /**
   * Emit a DSK SSE event to all subscribers for an API key.
   * Dead connections are pruned automatically.
   * @param {string} apiKey
   * @param {string} eventName  SSE event name
   * @param {object} data       JSON-serialisable payload
   */
  emitDskEvent(apiKey, eventName, data) {
    const set = this._subscribers.get(apiKey);
    if (!set || set.size === 0) return;
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...set]) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
    if (set.size === 0) this._subscribers.delete(apiKey);
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
