const { NetworkError } = require('./errors.cjs');

/**
 * Client for sending live captions via an lcyt-backend relay.
 *
 * Mirrors the YoutubeLiveCaptionSender API but communicates with an
 * lcyt-backend HTTP server instead of directly with YouTube. Uses
 * fetch() — works in browsers and Node 18+.
 *
 * @example
 * const sender = new BackendCaptionSender({
 *   backendUrl: 'https://captions.example.com',
 *   apiKey: 'a1b2c3d4-...',
 *   streamKey: 'YOUR_YOUTUBE_KEY'
 * });
 *
 * await sender.start();
 * await sender.send('Hello!');
 * await sender.send('Relative', { time: 5000 });
 * await sender.sync();
 * const status = await sender.heartbeat();
 * await sender.end();
 */
class BackendCaptionSender {
  /**
   * @param {object} options
   * @param {string} options.backendUrl - Base URL of the lcyt-backend server (e.g. "https://captions.example.com")
   * @param {string} options.apiKey - API key registered in the backend's SQLite database
   * @param {string} options.streamKey - YouTube stream key
   * @param {string} [options.domain] - CORS origin. Defaults to location.origin in browsers or 'http://localhost' in Node.
   * @param {number} [options.sequence=0] - Starting sequence number (overridden by backend response on start())
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   */
  constructor({
    backendUrl,
    apiKey,
    streamKey,
    domain,
    sequence = 0,
    verbose = false
  } = {}) {
    this.backendUrl = backendUrl;
    this.apiKey = apiKey;
    this.streamKey = streamKey;
    this.domain = domain ||
      (typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost');
    this.sequence = sequence;
    this.verbose = verbose;

    this.isStarted = false;
    this.syncOffset = 0;
    this.startedAt = 0;

    this._token = null;
    this._queue = [];
  }

  // ---------------------------------------------------------------------------
  // Internal fetch helper
  // ---------------------------------------------------------------------------

  /**
   * Make an authenticated JSON request to the backend.
   *
   * @param {string} path - Endpoint path (e.g. '/live')
   * @param {object} [options]
   * @param {string} [options.method='GET']
   * @param {object} [options.body] - Request body (serialised to JSON)
   * @param {boolean} [options.auth=true] - Attach Authorization header if token is available
   * @returns {Promise<object>} Parsed JSON response
   * @throws {NetworkError} On non-2xx response or network failure
   */
  async _fetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && this._token) {
      headers['Authorization'] = `Bearer ${this._token}`;
    }

    const res = await fetch(`${this.backendUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json();
    if (!res.ok) {
      throw new NetworkError(data.error || `HTTP ${res.status}`, res.status);
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Register a session with the backend and obtain a JWT.
   * Updates sequence, syncOffset, and startedAt from the server response.
   * @returns {Promise<this>}
   */
  async start() {
    const data = await this._fetch('/live', {
      method: 'POST',
      body: {
        apiKey: this.apiKey,
        streamKey: this.streamKey,
        domain: this.domain,
        sequence: this.sequence
      },
      auth: false
    });

    this._token = data.token;
    this.sequence = data.sequence;
    this.syncOffset = data.syncOffset;
    this.startedAt = data.startedAt;
    this.isStarted = true;

    return this;
  }

  /**
   * Tear down the backend session and clear the stored JWT.
   * @returns {Promise<this>}
   */
  async end() {
    await this._fetch('/live', { method: 'DELETE' });
    this._token = null;
    this.isStarted = false;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Caption sending
  // ---------------------------------------------------------------------------

  /**
   * Send a single caption.
   *
   * @param {string} text - Caption text
   * @param {string|Date|number|{time: number}} [timestampOrOptions]
   *   - Absolute timestamp (string/Date/epoch ms) — passed as `timestamp`
   *   - `{ time: number }` — milliseconds since session start, resolved server-side
   *   - Omit for auto-generated timestamp
   * @returns {Promise<{ok: boolean, requestId: string}>} Immediate ack; delivery result arrives via GET /events SSE stream
   */
  async send(text, timestampOrOptions) {
    const caption = { text };

    if (timestampOrOptions !== undefined) {
      if (
        typeof timestampOrOptions === 'object' &&
        timestampOrOptions !== null &&
        'time' in timestampOrOptions
      ) {
        caption.time = timestampOrOptions.time;
      } else {
        caption.timestamp = timestampOrOptions;
      }
    }

    return this._fetch('/captions', {
      method: 'POST',
      body: { captions: [caption] }
    });
  }

  /**
   * Send multiple captions in one request.
   * If no array is provided, drains and sends the internal queue (built with construct()).
   *
   * @param {Array<{text: string, timestamp?: string|Date|number, time?: number}>} [captions]
   * @returns {Promise<{ok: boolean, requestId: string}>} Immediate ack; delivery result arrives via GET /events SSE stream
   */
  async sendBatch(captions) {
    const items = captions !== undefined ? captions : [...this._queue];
    if (captions === undefined) {
      this._queue = [];
    }

    return this._fetch('/captions', {
      method: 'POST',
      body: { captions: items }
    });
  }

  // ---------------------------------------------------------------------------
  // Local queue (construct/sendBatch pattern)
  // ---------------------------------------------------------------------------

  /**
   * Add a caption to the local queue without sending.
   * Use sendBatch() (with no arguments) to flush the queue.
   *
   * @param {string} text - Caption text
   * @param {string|Date|number} [timestamp] - Optional timestamp
   * @returns {number} Current queue length
   */
  construct(text, timestamp) {
    this._queue.push({ text, timestamp: timestamp !== undefined ? timestamp : null });
    return this._queue.length;
  }

  /**
   * Return a copy of the current local queue.
   * @returns {Array<{text: string, timestamp: *}>}
   */
  getQueue() {
    return [...this._queue];
  }

  /**
   * Clear the local queue.
   * @returns {number} Number of items cleared
   */
  clearQueue() {
    const count = this._queue.length;
    this._queue = [];
    return count;
  }

  // ---------------------------------------------------------------------------
  // Sync and heartbeat
  // ---------------------------------------------------------------------------

  /**
   * Trigger an NTP-style clock sync on the backend.
   * Updates local syncOffset from the response.
   * @returns {Promise<object>} { syncOffset, roundTripTime, serverTimestamp, statusCode }
   */
  async sync() {
    const data = await this._fetch('/sync', { method: 'POST' });
    this.syncOffset = data.syncOffset;
    return data;
  }

  /**
   * Check session status on the backend.
   * Updates local sequence and syncOffset.
   * @returns {Promise<{sequence: number, syncOffset: number}>}
   */
  async heartbeat() {
    const data = await this._fetch('/live');
    this.sequence = data.sequence;
    this.syncOffset = data.syncOffset;
    return data;
  }

  /**
   * Update session fields on the backend (e.g. sequence).
   * @param {object} fields - Key/value pairs to PATCH to /live
   * @returns {Promise<object>} Parsed JSON response
   */
  async updateSession(fields) {
    return this._fetch('/live', { method: 'PATCH', body: fields });
  }

  // ---------------------------------------------------------------------------
  // Getters / setters
  // ---------------------------------------------------------------------------

  getSequence() { return this.sequence; }
  setSequence(seq) { this.sequence = seq; return this; }

  getSyncOffset() { return this.syncOffset; }
  setSyncOffset(offset) { this.syncOffset = offset; return this; }

  getStartedAt() { return this.startedAt; }
}

module.exports = { BackendCaptionSender };
