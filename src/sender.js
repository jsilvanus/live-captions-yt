const http = require('http');
const https = require('https');
const { URL } = require('url');
const { ConfigError, NetworkError, ValidationError } = require('./errors');
const logger = require('./logger');

// Default YouTube Live caption ingestion URL
const DEFAULT_YOUTUBE_URL = 'http://upload.youtube.com/closedcaption';

class YoutubeLiveCaptionSender {
  constructor(options = {}) {
    this.ingestionUrl = options.ingestionUrl || null;
    this.lang = options.lang || 'en';
    this.name = options.name || 'LCYT';
    this.sequence = options.sequence || 0;
    this.isStarted = false;
    this.verbose = options.verbose || false;
    this._queue = []; // Internal queue for construct/sendBatch pattern

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

  start() {
    this.isStarted = true;
    logger.info(`Caption sender started (lang: ${this.lang}, name: ${this.name})`);
    return this;
  }

  /**
   * Send a single caption
   * @param {string} text - Caption text (use <br> for line breaks)
   * @param {string} [timestamp] - ISO timestamp (auto-generated if not provided)
   * @returns {Promise<{sequence, timestamp, statusCode, response, serverTimestamp}>}
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

    // Google format: timestamp on one line, text on next line
    const body = `${ts}\n${text}`;

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
   * Add a caption to the internal queue for later batch sending
   * @param {string} text - Caption text
   * @param {string} [timestamp] - ISO timestamp (auto-generated at send time if not provided)
   * @returns {number} Number of captions in queue
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
   * Get the current queue
   * @returns {Array<{text: string, timestamp: string|null}>}
   */
  getQueue() {
    return [...this._queue];
  }

  /**
   * Clear the caption queue
   * @returns {number} Number of captions that were cleared
   */
  clearQueue() {
    const count = this._queue.length;
    this._queue = [];
    logger.debug(`Cleared ${count} caption(s) from queue`);
    return count;
  }

  /**
   * Send multiple captions in a single POST request
   * If no captions provided, sends the internal queue built with construct()
   * @param {Array<{text: string, timestamp?: string}>} [captions] - Array of caption objects (optional)
   * @returns {Promise<{sequence, count, statusCode, response, serverTimestamp}>}
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

    // Build body with alternating timestamp/text lines
    for (let i = 0; i < captionsToSend.length; i++) {
      const caption = captionsToSend[i];

      if (!caption.text || typeof caption.text !== 'string') {
        throw new ValidationError(`Caption at index ${i} must have a text string.`, 'captions');
      }

      // Auto-generate timestamp if not provided, spacing them 100ms apart
      let ts;
      if (caption.timestamp) {
        ts = this._formatTimestamp(caption.timestamp);
      } else {
        const now = new Date();
        now.setMilliseconds(now.getMilliseconds() + (i * 100));
        ts = this._formatTimestamp(now.toISOString());
      }

      lines.push(ts);
      lines.push(caption.text);
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
   * Send a heartbeat (empty POST) to verify connection
   * Can also be used for clock synchronization via returned server timestamp
   * @returns {Promise<{sequence, statusCode, serverTimestamp}>}
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

  end() {
    this.isStarted = false;
    logger.info(`Caption sender stopped. Total captions sent: ${this.sequence}`);
    return this;
  }

  getSequence() {
    return this.sequence;
  }

  setSequence(seq) {
    this.sequence = seq;
    return this;
  }
}

module.exports = { YoutubeLiveCaptionSender, DEFAULT_YOUTUBE_URL };
