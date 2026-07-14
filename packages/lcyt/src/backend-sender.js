import { NetworkError } from './errors.js';

/**
 * Client for sending live captions via an lcyt-backend relay.
 *
 * Mirrors the YoutubeLiveCaptionSender API but communicates with an
 * lcyt-backend HTTP server instead of directly with YouTube. Uses
 * fetch() — works in browsers and Node 18+.
 *
 * @example
 * // Target-array mode (recommended): all targets configured server-side via CC → Targets
 * const sender = new BackendCaptionSender({
 *   backendUrl: 'https://captions.example.com',
 *   apiKey: 'a1b2c3d4-...',
 * });
 * await sender.start({ targets: [{ id: '1', type: 'youtube', streamKey: 'YOUR_KEY' }] });
 *
 * // Legacy single-target mode: pass a streamKey directly
 * const sender = new BackendCaptionSender({
 *   backendUrl: 'https://captions.example.com',
 *   apiKey: 'a1b2c3d4-...',
 *   streamKey: 'YOUR_YOUTUBE_KEY'
 * });
 * await sender.start();
 *
 * await sender.send('Hello!');
 * await sender.sync();
 * await sender.end();
 */
export class BackendCaptionSender {
  /**
   * @param {object} options
   * @param {string} options.backendUrl - Base URL of the lcyt-backend server (e.g. "https://captions.example.com")
   * @param {string} options.apiKey - API key registered in the backend's SQLite database
   * @param {string} [options.authToken] - Project-scoped JWT used for authenticated project requests
   * @param {string} [options.streamKey] - YouTube stream key (optional; superseded by the `targets` array in `start()`)
   * @param {string} [options.domain] - CORS origin. Defaults to location.origin in browsers or 'http://localhost' in Node.
   * @param {number} [options.sequence=0] - Starting sequence number (overridden by backend response on start())
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   */
  constructor({
    backendUrl,
    apiKey,
    authToken,
    streamKey,
    domain,
    sequence = 0,
    verbose = false
  } = {}) {
    this.backendUrl = backendUrl;
    this.apiKey = apiKey;
    this.authToken = authToken || null;
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
  _getAuthToken(auth = true) {
    if (!auth) return null;
    return this.authToken || this._token || null;
  }

  async _fetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this._getAuthToken(auth);
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
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
   *
   * @param {object} [options]
   * @param {Array} [options.targets] - Optional array of extra caption targets to register with the session.
   *   Each entry: { id, type: 'youtube'|'generic', streamKey?, url?, headers? }
   * @returns {Promise<this>}
   */
  async start({ targets } = {}) {
    const body = {
      apiKey: this.apiKey,
      domain: this.domain,
      sequence: this.sequence
    };
    // streamKey is optional: include it only when provided (legacy single-target mode).
    if (this.streamKey !== null && this.streamKey !== undefined && this.streamKey !== '') {
      body.streamKey = this.streamKey;
    }
    if (Array.isArray(targets) && targets.length > 0) {
      body.targets = targets;
    }
    const data = await this._fetch('/live', {
      method: 'POST',
      body,
      auth: true
    });

    this._token = data.token;
    this.sequence = data.sequence;
    this.syncOffset = data.syncOffset;
    this.startedAt = data.startedAt;
    this.graphicsEnabled = data.graphicsEnabled === true;
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
   * @param {object} [extraOpts] - Optional extra fields to merge into the caption object
   *   e.g. { translations: { 'fi-FI': '...' }, captionLang: 'fi-FI', showOriginal: true,
   *          fileFormats: { original: 'vtt', 'fi-FI': 'vtt' } }
   *   `fileFormats` selects the backend caption-file format per language
   *   ('text' | 'youtube' | 'vtt'; 'original' keys the untranslated text)
   * @returns {Promise<{ok: boolean, requestId: string}>} Immediate ack; delivery result arrives via GET /events SSE stream
   */
  async send(text, timestampOrOptions, extraOpts) {
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

    if (extraOpts) {
      if (extraOpts.translations && Object.keys(extraOpts.translations).length > 0)
        caption.translations = extraOpts.translations;
      if (extraOpts.captionLang) caption.captionLang = extraOpts.captionLang;
      if (extraOpts.showOriginal !== undefined) caption.showOriginal = extraOpts.showOriginal;
      if (extraOpts.codes && typeof extraOpts.codes === 'object') caption.codes = extraOpts.codes;
      if (extraOpts.fileFormats && typeof extraOpts.fileFormats === 'object') caption.fileFormats = extraOpts.fileFormats;
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
   * When `timestamp` is omitted, the caption is stamped with the current time
   * at queue time (ISO string, no trailing 'Z') so batched captions keep
   * their real spacing instead of collapsing to the flush time.
   *
   * @param {string} text - Caption text
   * @param {string|Date|number|{time: number}} [timestamp] - Optional timestamp,
   *   or `{ time }` (ms since session start, resolved server-side)
   * @param {object} [extraOpts] - Same whitelisted fields as send():
   *   translations, captionLang, showOriginal, codes, fileFormats
   * @returns {number} Current queue length
   */
  construct(text, timestamp, extraOpts) {
    const caption = { text };

    if (timestamp !== undefined && timestamp !== null) {
      if (typeof timestamp === 'object' && !(timestamp instanceof Date) && 'time' in timestamp) {
        caption.time = timestamp.time;
      } else {
        caption.timestamp = timestamp;
      }
    } else {
      caption.timestamp = new Date().toISOString().replace('Z', '');
    }

    if (extraOpts) {
      if (extraOpts.translations && Object.keys(extraOpts.translations).length > 0)
        caption.translations = extraOpts.translations;
      if (extraOpts.captionLang) caption.captionLang = extraOpts.captionLang;
      if (extraOpts.showOriginal !== undefined) caption.showOriginal = extraOpts.showOriginal;
      if (extraOpts.codes && typeof extraOpts.codes === 'object') caption.codes = extraOpts.codes;
      if (extraOpts.fileFormats && typeof extraOpts.fileFormats === 'object') caption.fileFormats = extraOpts.fileFormats;
    }

    this._queue.push(caption);
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
