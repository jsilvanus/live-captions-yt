const http = require('http');
const https = require('https');
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
   * Format timestamp to Google's expected format: YYYY-MM-DDTHH:MM:SS.mmm
   * (no 'Z' suffix, no timezone)
   */
  _formatTimestamp(timestamp) {
    if (timestamp && !timestamp.endsWith('Z')) {
      return timestamp;
    }
    const date = timestamp ? new Date(timestamp) : new Date();
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
      let parsedUrl;
      try {
        parsedUrl = this._buildRequestUrl(seq);
      } catch (err) {
        reject(new ConfigError(`Invalid ingestion URL: ${this.ingestionUrl}`));
        return;
      }

      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      logger.debug(`POST to ${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`);
      logger.debug(`Body:\n${body}`);

      const req = transport.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          // Parse server timestamp from response (if present)
          const serverTimestamp = data.trim() || null;

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
    logger.info(`Caption sender started (region: ${this.region}, cue: ${this.cue})`);
    return this;
  }

  /**
   * Send a single caption to the YouTube Live stream.
   * @param {string} text - Caption text (use <br> for line breaks within the caption)
   * @param {string} [timestamp] - ISO timestamp in format YYYY-MM-DDTHH:MM:SS.mmm (auto-generated if not provided)
   * @returns {Promise<Object>} Result object
   * @returns {number} return.sequence - The sequence number used for this caption
   * @returns {string} return.timestamp - The timestamp sent with the caption
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
   * // With custom timestamp
   * await sender.send('Custom time', '2024-01-15T12:00:00.000');
   */
  async send(text, timestamp) {
    if (!this.isStarted) {
      throw new ValidationError('Sender not started. Call start() first.', 'isStarted');
    }

    if (!this.ingestionUrl) {
      throw new ConfigError('No ingestion URL configured.');
    }

    if (!text || typeof text !== 'string') {
      throw new ValidationError('Caption text is required and must be a string.', 'text');
    }

    const ts = this._formatTimestamp(timestamp);
    const seq = this.sequence;

    const body = this._buildCaptionBody(timestamp, text, this.useRegion);

    const result = await this._sendPost(body, seq);
    this.sequence++;

    if (result.statusCode >= 200 && result.statusCode < 300) {
      logger.success(`Sent caption #${seq}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    } else {
      logger.warn(`Caption #${seq} sent with status ${result.statusCode}`);
    }

    return {
      sequence: seq,
      timestamp: ts,
      statusCode: result.statusCode,
      response: result.response,
      serverTimestamp: result.serverTimestamp
    };
  }

  /**
   * Add a caption to the internal queue for later batch sending with sendBatch().
   * @param {string} text - Caption text (use <br> for line breaks within the caption)
   * @param {string} [timestamp] - ISO timestamp in format YYYY-MM-DDTHH:MM:SS.mmm (auto-generated at send time if not provided)
   * @returns {number} Number of captions currently in queue after adding
   * @throws {ValidationError} If text is empty or not a string
   * @example
   * sender.construct('First caption');
   * sender.construct('Second caption', '2024-01-15T12:00:00.500');
   * await sender.sendBatch(); // Sends both captions
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
   * @param {Array<{text: string, timestamp?: string}>} [captions] - Array of caption objects. If omitted, uses internal queue.
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
   * // Option 1: Pass array directly
   * await sender.sendBatch([
   *   { text: 'First caption' },
   *   { text: 'Second caption', timestamp: '2024-01-15T12:00:00.500' }
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
        const now = new Date();
        now.setMilliseconds(now.getMilliseconds() + (i * 100));
        timestamp = now.toISOString();
      }

      lines.push(this._buildCaptionBody(timestamp, caption.text, this.useRegion));
    }

    const body = lines.join('\n');
    const result = await this._sendPost(body, seq);
    this.sequence++;

    // Clear queue if we used it
    if (!captions) {
      this._queue = [];
    }

    if (result.statusCode >= 200 && result.statusCode < 300) {
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
}

module.exports = { YoutubeLiveCaptionSender, DEFAULT_YOUTUBE_URL };
