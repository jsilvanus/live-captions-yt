const http = require('http');
const https = require('https');
const { URL } = require('url');
const { ConfigError, NetworkError, ValidationError } = require('./errors');
const logger = require('./logger');

class YoutubeLiveCaptionSender {
  constructor(options = {}) {
    this.ingestionUrl = options.ingestionUrl || null;
    this.lang = options.lang || 'en';
    this.name = options.name || 'LCYT';
    this.sequence = options.sequence || 0;
    this.isStarted = false;
    this.verbose = options.verbose || false;

    if (this.verbose) {
      logger.setVerbose(true);
    }
  }

  start() {
    this.isStarted = true;
    logger.info(`Caption sender started (lang: ${this.lang}, name: ${this.name})`);
    return this;
  }

  send(text, timestamp) {
    return new Promise((resolve, reject) => {
      if (!this.isStarted) {
        reject(new ValidationError('Sender not started. Call start() first.', 'isStarted'));
        return;
      }

      if (!this.ingestionUrl) {
        reject(new ConfigError('No ingestion URL configured.'));
        return;
      }

      if (!text || typeof text !== 'string') {
        reject(new ValidationError('Caption text is required and must be a string.', 'text'));
        return;
      }

      const ts = timestamp || new Date().toISOString();
      const seq = this.sequence;

      const params = new URLSearchParams();
      params.append('seq', seq.toString());
      params.append('lang', this.lang);
      params.append('name', this.name);
      params.append('text', text);
      params.append('timestamp', ts);

      const body = params.toString();

      let parsedUrl;
      try {
        parsedUrl = new URL(this.ingestionUrl);
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
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      logger.debug(`Sending to ${parsedUrl.hostname}${parsedUrl.pathname}`);

      const req = transport.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          this.sequence++;

          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.success(`Sent caption #${seq}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
          } else {
            logger.warn(`Caption #${seq} sent with status ${res.statusCode}`);
          }

          logger.debug(`Response: ${data}`);

          resolve({
            sequence: seq,
            timestamp: ts,
            statusCode: res.statusCode,
            response: data
          });
        });
      });

      req.on('error', (err) => {
        logger.error(`Network error: ${err.message}`);
        reject(new NetworkError(`Failed to send caption: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
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

module.exports = { YoutubeLiveCaptionSender };
