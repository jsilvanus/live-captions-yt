const http = require('http');
const https = require('https');
const { URL } = require('url');

class YoutubeLiveCaptionSender {
  constructor(options = {}) {
    this.ingestionUrl = options.ingestionUrl || null;
    this.lang = options.lang || 'en';
    this.name = options.name || 'LCYT';
    this.sequence = options.sequence || 0;
    this.isStarted = false;
  }

  start() {
    this.isStarted = true;
    console.log(`[LCYT] Caption sender started (lang: ${this.lang}, name: ${this.name})`);
    return this;
  }

  send(text, timestamp) {
    return new Promise((resolve, reject) => {
      if (!this.isStarted) {
        reject(new Error('Sender not started. Call start() first.'));
        return;
      }

      if (!this.ingestionUrl) {
        reject(new Error('No ingestion URL configured.'));
        return;
      }

      if (!text || typeof text !== 'string') {
        reject(new Error('Caption text is required and must be a string.'));
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
      const parsedUrl = new URL(this.ingestionUrl);
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

      const req = transport.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          this.sequence++;
          console.log(`[LCYT] Sent caption #${seq}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
          resolve({
            sequence: seq,
            timestamp: ts,
            statusCode: res.statusCode,
            response: data
          });
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Failed to send caption: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }

  end() {
    this.isStarted = false;
    console.log(`[LCYT] Caption sender stopped. Total captions sent: ${this.sequence}`);
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
