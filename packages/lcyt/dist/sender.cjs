const http = require('http');
const { URL } = require('url');
const { ConfigError, NetworkError, ValidationError } = require('./errors.cjs');
const logger = require('./logger.cjs');

// Default YouTube Live caption ingestion URL base
const DEFAULT_YOUTUBE_URL = 'http://upload.youtube.com/closedcaption';

/**
 * Client for sending live captions to YouTube Live streams using Google's closed caption API.
 * @class
 * @example
 * const sender = new YoutubeLiveCaptionSender({
 *   streamKey: 'YOUR_STREAM_KEY'
 * });
 * sender.start();
 * await sender.send('Hello, world!');
 * sender.end();
 */
class YoutubeLiveCaptionSender {
  /**
   * Create a new YoutubeLiveCaptionSender instance.
   * @param {Object} [options={}] - Configuration options
   * @param {string} [options.streamKey=null] - YouTube stream key (cid value)
   * @param {string} [options.baseUrl] - Base ingestion URL (defaults to YouTube's upload.youtube.com endpoint)
   * @param {string} [options.ingestionUrl=null] - Full pre-built ingestion URL (overrides streamKey and baseUrl)
   * @param {string} [options.region='reg1'] - Region identifier for captions
   * @param {string} [options.cue='cue1'] - Cue identifier for captions
   * @param {boolean} [options.useRegion=false] - Include region/cue in caption body
   * @param {number} [options.sequence=0] - Starting sequence number
   * @param {boolean} [options.useSyncOffset=false] - Apply syncOffset to auto-generated timestamps
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   */
  constructor(options = {}) {
    this.streamKey = options.streamKey || null;
    this.baseUrl = options.baseUrl || DEFAULT_YOUTUBE_URL;
    this.region = options.region || 'reg1';
    this.cue = options.cue || 'cue1';
    this.useRegion = options.useRegion || false;
    this.sequence = options.sequence || 0;
    this.isStarted = false;
    this.syncOffset = 0; // Clock offset in ms (positive = server ahead of local)
    this.useSyncOffset = options.useSyncOffset || false;
    this.verbose = options.verbose || false;
    this._queue = []; // Internal queue for construct/sendBatch pattern

    // Build ingestion URL: use provided ingestionUrl, or build from streamKey + baseUrl
    if (options.ingestionUrl) {
      this.ingestionUrl = options.ingestionUrl;
    } else if (this.streamKey) {
      this.ingestionUrl = `${this.baseUrl}?cid=${this.streamKey}`;
    } else {
      this.ingestionUrl = null;
    }

    if (this.verbose) {
      logger.setVerbose(true);
    }
  }

  /**
   * Get current time in ms, adjusted by syncOffset when useSyncOffset is enabled.
   * @returns {number} Current time in epoch milliseconds (possibly offset-adjusted)
   */
  _now() {
    return Date.now() + (this.useSyncOffset ? this.syncOffset : 0);
  }

  /**
   * Format timestamp to Google's expected format: YYYY-MM-DDTHH:MM:SS.mmm
   * (no 'Z' suffix, no timezone offset).
   *
   * Accepts:
   * - Date object — converted directly
   * - number >= 1000 — Unix epoch in milliseconds (Date.now() style)
   * - number < 1000 or negative — relative offset in seconds from current time
   * - ISO string with or without trailing 'Z'
   * - undefined — auto-generates current time (adjusted by syncOffset if enabled)
   */
  _formatTimestamp(timestamp) {
    if (timestamp instanceof Date) {
      return timestamp.toISOString().slice(0, -1); // Remove the 'Z'
    }
    if (typeof timestamp === 'number') {
      const date = timestamp < 1000
        ? new Date(this._now() + timestamp * 1000) // relative offset in seconds
        : new Date(timestamp);                      // epoch milliseconds
      return date.toISOString().slice(0, -1);
    }
    if (timestamp && !timestamp.endsWith('Z')) {
      return timestamp;
    }
    const date = timestamp ? new Date(timestamp) : new Date(this._now());
    const iso = date.toISOString();
    return iso.slice(0, -1); // Remove the 'Z'
  }

  /**
   * Build the request URL with seq param
   */
  _buildRequestUrl(seq) {
    const parsedUrl = new URL(this.ingestionUrl);
    parsedUrl.searchParams.set('seq', seq.toString());
    return parsedUrl;
  }

  /**
   * Build caption body for a single caption.
   * Format: timestamp (with optional region/cue) on one line, text on next line.
   * Modify this method to change the caption format globally.
   */
  _buildCaptionBody(timestamp, text, useRegion = false) {
    const ts = this._formatTimestamp(timestamp);
    const regionCue = (useRegion && this.region && this.cue) ? ` region:${this.region}#${this.cue}` : '';
    return `${ts}${regionCue}\n${text}`;
  }

  /**
   * Internal method to send POST request
   */
  _sendPost(body, seq) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = this._buildRequestUrl(seq);
      } catch (err) {
        reject(new ConfigError(`Invalid ingestion URL: ${this.ingestionUrl}`));
        return;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      logger.debug(`POST ${options.path}`);
      logger.debug(`Host: ${options.hostname}`);
      logger.debug(`Content-Type: ${options.headers['Content-Type']}`);
      logger.debug(`Content-Length: ${options.headers['Content-Length']}`);
      logger.debug(`\n${body}`);

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const serverTimestamp = data.trim() || null;
          logger.debug(`Response [${res.statusCode}]: ${data || '(empty)'}`);
          resolve({
            statusCode: res.statusCode,
            response: data,
            serverTimestamp
          });
        });
      });

      req.on('error', (err) => {
        logger.error(`Network error: ${err.message}`);
        reject(new NetworkError(`Failed to send: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Start the caption sender. Must be called before sending captions.
   * @returns {YoutubeLiveCaptionSender} The sender instance for chaining
   * @throws {Error} If already started
   * @example
   * sender.start();
   */
  start() {
    this.isStarted = true;
    logger.info(`Caption sender started`);
    return this;
  }

  /**
   * Send a single caption to the YouTube Live stream.
   * @param {string} text - Caption text (use <br> for line breaks within the caption)
   * @param {string|Date|number} [timestamp] - Timestamp in one of these forms:
   *   - `Date` object
   *   - `number >= 1000`: Unix epoch in milliseconds (e.g. `Date.now()`)
   *   - `number < 1000` or negative: relative offset in seconds from now (e.g. `-2` = 2 seconds ago)
   *   - ISO string `YYYY-MM-DDTHH:MM:SS.mmm` (used as-is)
   *   - ISO string with trailing `Z` (auto-stripped)
   *   - Omitted: auto-generated current time
   *   Must be within 60 seconds of the server's current time.
   * @returns {Promise<Object>} Result object
   * @returns {number} return.sequence - The sequence number used for this caption
   * @returns {string} return.timestamp - The formatted timestamp sent with the caption
   * @returns {number} return.statusCode - HTTP status code from the server
   * @returns {string} return.response - Raw response body from the server
   * @returns {string|null} return.serverTimestamp - Server timestamp if returned
   * @throws {ValidationError} If sender not started or text is invalid
   * @throws {ConfigError} If no ingestion URL configured
   * @throws {NetworkError} If the request fails
   * @example
   * const result = await sender.send('Hello, world!');
   * console.log(result.sequence); // 0
   * @example
   * // With ISO string timestamp
   * await sender.send('Custom time', '2024-01-15T12:00:00.000');
   * @example
   * // With Date object
   * await sender.send('Custom time', new Date());
   * @example
   * // With epoch milliseconds (Date.now())
   * await sender.send('Custom time', Date.now());
   * @example
   * // With relative offset: 2 seconds ago
   * await sender.send('Custom time', -2);
   */
  async send(text, timestamp) {
    const result = await this.sendBatch([{ text, timestamp }]);
    return {
      sequence: result.sequence,
      timestamp: this._formatTimestamp(timestamp),
      statusCode: result.statusCode,
      response: result.response,
      serverTimestamp: result.serverTimestamp
    };
  }

  /**
   * Add a caption to the internal queue for later batch sending with sendBatch().
   * @param {string} text - Caption text (use <br> for line breaks within the caption)
   * @param {string|Date|number} [timestamp] - Accepts the same forms as `send()`:
   *   Date object, epoch milliseconds (>= 1000), relative seconds offset (< 1000 or negative),
   *   ISO string, or omitted (auto-generated at send time).
   * @returns {number} Number of captions currently in queue after adding
   * @throws {ValidationError} If text is empty or not a string
   * @example
   * sender.construct('First caption');
   * sender.construct('Second caption', '2024-01-15T12:00:00.500');
   * sender.construct('Third caption', new Date());
   * sender.construct('Fourth caption', Date.now());
   * sender.construct('Fifth caption', -2); // 2 seconds ago
   * await sender.sendBatch(); // Sends all queued captions
   */
  construct(text, timestamp) {
    if (!text || typeof text !== 'string') {
      throw new ValidationError('Caption text is required and must be a string.', 'text');
    }

    this._queue.push({ text, timestamp: timestamp || null });
    logger.debug(`Queued caption: "${text.substring(0, 30)}..." (${this._queue.length} in queue)`);
    return this._queue.length;
  }

  /**
   * Get a copy of the current caption queue.
   * @returns {Array<{text: string, timestamp: string|null}>} Copy of the queue array
   * @example
   * sender.construct('Caption 1');
   * sender.construct('Caption 2');
   * const queue = sender.getQueue();
   * console.log(queue.length); // 2
   */
  getQueue() {
    return [...this._queue];
  }

  /**
   * Clear all captions from the internal queue.
   * @returns {number} Number of captions that were cleared
   * @example
   * sender.construct('Caption 1');
   * sender.construct('Caption 2');
   * const cleared = sender.clearQueue(); // Returns 2
   * console.log(sender.getQueue().length); // 0
   */
  clearQueue() {
    const count = this._queue.length;
    this._queue = [];
    logger.debug(`Cleared ${count} caption(s) from queue`);
    return count;
  }

  /**
   * Send multiple captions in a single POST request.
   * If no captions array is provided, sends the internal queue built with construct() and clears it.
   * @param {Array<{text: string, timestamp?: string|Date|number}>} [captions] - Array of caption objects. If omitted, uses internal queue.
   *   Each `timestamp` accepts the same forms as `send()` (Date, epoch ms, relative seconds, ISO string, or omitted — auto-generated 100ms apart).
   * @returns {Promise<Object>} Result object
   * @returns {number} return.sequence - The sequence number used for this batch
   * @returns {number} return.count - Number of captions sent
   * @returns {number} return.statusCode - HTTP status code from the server
   * @returns {string} return.response - Raw response body from the server
   * @returns {string|null} return.serverTimestamp - Server timestamp if returned
   * @throws {ValidationError} If sender not started or no captions to send
   * @throws {ConfigError} If no ingestion URL configured
   * @throws {NetworkError} If the request fails
   * @example
   * // Option 1: Pass array directly (any supported timestamp form)
   * await sender.sendBatch([
   *   { text: 'First caption' },
   *   { text: 'Second caption', timestamp: '2024-01-15T12:00:00.500' },
   *   { text: 'Third caption', timestamp: new Date() },
   *   { text: 'Fourth caption', timestamp: Date.now() },
   *   { text: 'Fifth caption', timestamp: -1 } // 1 second ago
   * ]);
   * @example
   * // Option 2: Use construct() then sendBatch()
   * sender.construct('First caption');
   * sender.construct('Second caption');
   * await sender.sendBatch(); // Sends queue and clears it
   */
  async sendBatch(captions) {
    if (!this.isStarted) {
      throw new ValidationError('Sender not started. Call start() first.', 'isStarted');
    }

    if (!this.ingestionUrl) {
      throw new ConfigError('No ingestion URL configured.');
    }

    // Use internal queue if no captions provided
    const captionsToSend = captions || this._queue;

    if (!Array.isArray(captionsToSend) || captionsToSend.length === 0) {
      throw new ValidationError('No captions to send. Use construct() to queue captions first, or pass an array.', 'captions');
    }

    const seq = this.sequence;
    const lines = [];

    // Build body with each caption
    for (let i = 0; i < captionsToSend.length; i++) {
      const caption = captionsToSend[i];

      if (!caption.text || typeof caption.text !== 'string') {
        throw new ValidationError(`Caption at index ${i} must have a text string.`, 'captions');
      }

      // Auto-generate timestamp if not provided, spacing them 100ms apart
      let timestamp = caption.timestamp;
      if (!timestamp) {
        const now = new Date(this._now() + (i * 100));
        timestamp = now.toISOString();
      }

      lines.push(this._buildCaptionBody(timestamp, caption.text, this.useRegion));
    }

    const body = lines.join('\n') + '\n';
    logger.debug(`Batch body (${lines.length} captions):\n${body}`);
    const result = await this._sendPost(body, seq);

    // Clear queue if we used it
    if (!captions) {
      this._queue = [];
    }

    if (result.statusCode >= 200 && result.statusCode < 300) {
      this.sequence++;
      logger.success(`Sent batch #${seq}: ${captionsToSend.length} caption(s)`);
    } else {
      logger.warn(`Batch #${seq} sent with status ${result.statusCode}`);
    }

    return {
      sequence: seq,
      count: captionsToSend.length,
      statusCode: result.statusCode,
      response: result.response,
      serverTimestamp: result.serverTimestamp
    };
  }

  /**
   * Send a heartbeat (empty POST) to verify the connection is working.
   * Can also be used for clock synchronization via the returned server timestamp.
   * Note: Heartbeat does NOT increment the sequence number per Google's spec.
   * @returns {Promise<Object>} Result object
   * @returns {number} return.sequence - The current sequence number (not incremented)
   * @returns {number} return.statusCode - HTTP status code from the server
   * @returns {string|null} return.serverTimestamp - Server timestamp for clock sync
   * @throws {ValidationError} If sender not started
   * @throws {ConfigError} If no ingestion URL configured
   * @throws {NetworkError} If the request fails
   * @example
   * const result = await sender.heartbeat();
   * if (result.statusCode === 200) {
   *   console.log('Connection OK, server time:', result.serverTimestamp);
   * }
   */
  async heartbeat() {
    if (!this.isStarted) {
      throw new ValidationError('Sender not started. Call start() first.', 'isStarted');
    }

    if (!this.ingestionUrl) {
      throw new ConfigError('No ingestion URL configured.');
    }

    const seq = this.sequence;
    const body = ''; // Empty body for heartbeat

    const result = await this._sendPost(body, seq);
    // Note: heartbeat does NOT increment sequence per Google's spec
    // (only new caption data increments)

    if (result.statusCode >= 200 && result.statusCode < 300) {
      logger.success(`Heartbeat #${seq} OK`);
    } else {
      logger.warn(`Heartbeat #${seq} returned status ${result.statusCode}`);
    }

    return {
      sequence: seq,
      statusCode: result.statusCode,
      serverTimestamp: result.serverTimestamp
    };
  }

  /**
   * Synchronize the local clock with YouTube's server clock using a heartbeat.
   * Computes the offset between local time and server time (NTP-style midpoint
   * estimation) and stores it as syncOffset. Automatically enables useSyncOffset.
   * @returns {Promise<Object>} Result object
   * @returns {number} return.syncOffset - Clock offset in ms (positive = server ahead)
   * @returns {number} return.roundTripTime - HTTP round-trip time in ms
   * @returns {string|null} return.serverTimestamp - Server timestamp if returned
   * @returns {number} return.statusCode - HTTP status code from the server
   * @throws {ValidationError} If sender not started
   * @throws {ConfigError} If no ingestion URL configured
   * @throws {NetworkError} If the request fails
   * @example
   * sender.start();
   * const result = await sender.sync();
   * console.log(`Offset: ${result.syncOffset}ms, RTT: ${result.roundTripTime}ms`);
   */
  async sync() {
    const t1 = Date.now();
    const result = await this.heartbeat();
    const t2 = Date.now();
    const roundTripTime = t2 - t1;

    if (!result.serverTimestamp) {
      logger.warn('No server timestamp in heartbeat response — syncOffset not updated');
      return { syncOffset: this.syncOffset, roundTripTime, serverTimestamp: null, statusCode: result.statusCode };
    }

    // Parse server timestamp (format: YYYY-MM-DDTHH:MM:SS.mmm — no Z, treat as UTC)
    const serverTime = new Date(result.serverTimestamp + 'Z').getTime();
    const localEstimate = (t1 + t2) / 2;
    this.syncOffset = Math.round(serverTime - localEstimate);
    this.useSyncOffset = true;

    logger.info(`Synced: offset ${this.syncOffset}ms, RTT ${roundTripTime}ms`);

    return {
      syncOffset: this.syncOffset,
      roundTripTime,
      serverTimestamp: result.serverTimestamp,
      statusCode: result.statusCode
    };
  }

  /**
   * Get the current sync offset in milliseconds.
   * @returns {number} Clock offset in ms (positive = server ahead of local)
   */
  getSyncOffset() {
    return this.syncOffset;
  }

  /**
   * Set the sync offset manually (e.g. to restore a previously computed offset).
   * @param {number} offset - Clock offset in ms
   * @returns {YoutubeLiveCaptionSender} The sender instance for chaining
   */
  setSyncOffset(offset) {
    this.syncOffset = offset;
    return this;
  }

  /**
   * Stop the caption sender and cleanup.
   * @returns {YoutubeLiveCaptionSender} The sender instance for chaining
   * @example
   * sender.end();
   */
  end() {
    this.isStarted = false;
    logger.info(`Caption sender stopped. Total captions sent: ${this.sequence}`);
    return this;
  }

  /**
   * Get the current sequence number.
   * @returns {number} Current sequence number
   * @example
   * const seq = sender.getSequence();
   */
  getSequence() {
    return this.sequence;
  }

  /**
   * Set the sequence number manually.
   * @param {number} seq - New sequence number
   * @returns {YoutubeLiveCaptionSender} The sender instance for chaining
   * @example
   * sender.setSequence(100);
   */
  setSequence(seq) {
    this.sequence = seq;
    return this;
  }

  /**
   * Test function that sends the exact example body from Google's docs.
   */
  async sendTest() {
    if (!this.isStarted) {
      throw new ValidationError('Sender not started. Call start() first.', 'isStarted');
    }
    if (!this.ingestionUrl) {
      throw new ConfigError('No ingestion URL configured.');
    }

    // Generate current timestamps (must be within 60 seconds of server time)
    const now = new Date(this._now());
    const ts1 = this._formatTimestamp(now.toISOString());
    now.setMilliseconds(now.getMilliseconds() + 100);
    const ts2 = this._formatTimestamp(now.toISOString());

    const body = `${ts1} region:reg1#cue1
HELLO
${ts2} region:reg1#cue1
WORLD
`;

    const seq = this.sequence;
    const result = await this._sendPost(body, seq);

    if (result.statusCode >= 200 && result.statusCode < 300) {
      this.sequence++;
      logger.success(`Test sent #${seq}`);
    } else {
      logger.warn(`Test #${seq} sent with status ${result.statusCode}`);
    }

    return result;
  }
}

module.exports = { YoutubeLiveCaptionSender, DEFAULT_YOUTUBE_URL };
