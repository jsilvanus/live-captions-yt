/**
 * AuditorLiveAdapter
 *
 * The pull-type STT source: instead of sending audio, it asks the auditor STT
 * service (liturgos-auditor-stt, `POST /v1/live`) to pull the stream from
 * MediaMTX (rtsp:// or srt://, usually on a fleet worker) and listens to the
 * resulting Server-Sent Events. Only final transcripts arrive, each with its own
 * absolute UTC time.
 *
 * Sessions on the service are not durable. When one ends while this adapter is
 * still wanted (service restart, stream lost for longer than the service's
 * reconnect window), the adapter starts a new one with backoff.
 *
 * Settings (stt.auditor_url, stt.auditor_api_key, stt.auditor_source_url) or env:
 *   AUDITOR_STT_URL          base URL of the service (required)
 *   AUDITOR_STT_API_KEY      bearer key, when the service has one
 *   AUDITOR_STT_SOURCE_URL   stream URL template; `{streamKey}` is replaced (default rtsp://127.0.0.1:8554/{streamKey})
 *
 * Events:
 *   transcript  ({ text, confidence: null, timestamp: Date, wallStart, wallEnd, sequence })
 *   error       ({ error })
 */

import { EventEmitter } from 'node:events';

const DEFAULT_SOURCE_URL = 'rtsp://127.0.0.1:8554/{streamKey}';

export class AuditorLiveAdapter extends EventEmitter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.language='en']
   * @param {string} [opts.streamKey]        Replaces `{streamKey}` in the source URL template
   * @param {string} [opts.baseUrl]          Override for AUDITOR_STT_URL
   * @param {string} [opts.apiKey]           Override for AUDITOR_STT_API_KEY
   * @param {string} [opts.sourceUrl]        Override for AUDITOR_STT_SOURCE_URL
   * @param {string} [opts.clientRef]        Echoed in the service's session list
   * @param {typeof fetch} [opts.fetch]
   * @param {number} [opts.retryMs=1000]     First retry delay; doubles up to `maxRetryMs`
   * @param {number} [opts.maxRetryMs=30000]
   */
  constructor({ language = 'en', streamKey, baseUrl, apiKey, sourceUrl, clientRef, fetch: fetchFn, retryMs = 1000, maxRetryMs = 30_000 } = {}) {
    super();
    this._language = language;
    this._streamKey = streamKey;
    this._baseUrl = (baseUrl ?? process.env.AUDITOR_STT_URL ?? '').replace(/\/$/, '');
    this._apiKey = apiKey ?? process.env.AUDITOR_STT_API_KEY ?? '';
    this._template = sourceUrl || process.env.AUDITOR_STT_SOURCE_URL || DEFAULT_SOURCE_URL;
    this._clientRef = clientRef;
    this._fetch = fetchFn ?? ((...args) => globalThis.fetch(...args));
    this._retryMs = retryMs;
    this._maxRetryMs = maxRetryMs;
    this._stopped = true;
    this._abort = null;
    this._sessionId = null;
    this._loop = null;
    this._lastError = null;
    this.mode = 'auditor-live';
  }

  get sessionId() { return this._sessionId; }

  async start({ language } = {}) {
    if (language) this._language = language;
    if (!this._baseUrl) {
      throw new Error('AuditorLiveAdapter: AUDITOR_STT_URL is not set. Set it to the base URL of the auditor STT service.');
    }
    this._stopped = false;
    // The first session is created here so a wrong URL, key or source host fails the start request.
    await this._open();
    this._loop = this._listen();
  }

  async stop() {
    this._stopped = true;
    this._abort?.abort();
    this._wake?.();
    const id = this._sessionId;
    this._sessionId = null;
    if (id) {
      try {
        await this._fetch(`${this._baseUrl}/v1/live/${id}`, { method: 'DELETE', headers: this._headers(), signal: AbortSignal.timeout(10_000) });
      } catch { /* the service ends it itself when the stream goes */ }
    }
    try { await this._loop; } catch { /* already reported */ }
  }

  // ── internals ───────────────────────────────────────────────────────────

  _headers(extra = {}) {
    return { ...(this._apiKey ? { Authorization: `Bearer ${this._apiKey}` } : {}), ...extra };
  }

  _sourceUrl() {
    return this._template.replace('{streamKey}', encodeURIComponent(this._streamKey ?? ''));
  }

  async _open() {
    const resp = await this._fetch(`${this._baseUrl}/v1/live`, {
      method: 'POST',
      headers: this._headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        source: this._sourceUrl(),
        language: this._language.split('-')[0],
        ...(this._clientRef ? { client_ref: this._clientRef } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json()).detail ?? ''; } catch { /* not json */ }
      throw new Error(`AuditorLiveAdapter: the service answered ${resp.status}${detail ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
    }
    const body = await resp.json();
    this._sessionId = body.id;
  }

  async _listen() {
    let delay = this._retryMs;
    let lastEventId = null;
    while (!this._stopped) {
      try {
        if (!this._sessionId) {
          await this._open();
          lastEventId = null;
        }
        const gotEvent = await this._readEvents(lastEventId, id => { lastEventId = id; });
        if (gotEvent) { delay = this._retryMs; this._lastError = null; }
        // The stream closed: the session ended (or the connection dropped). A session that
        // ended is gone; one whose connection dropped can be resumed with Last-Event-ID.
        if (this._ended) { this._sessionId = null; this._ended = false; }
      } catch (err) {
        if (this._stopped) return;
        this._report(err);
      }
      if (this._stopped) return;
      await this._sleep(delay);
      delay = Math.min(delay * 2, this._maxRetryMs);
    }
  }

  _report(err) {
    const message = err?.message ?? String(err);
    if (message === this._lastError) return; // do not repeat the same failure every retry
    this._lastError = message;
    this.emit('error', { error: err instanceof Error ? err : new Error(message) });
  }

  _sleep(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      this._wake = () => { clearTimeout(timer); resolve(); };
    });
  }

  /** Read one SSE connection to its end. Returns true when at least one event arrived. */
  async _readEvents(lastEventId, onId) {
    this._abort = new AbortController();
    const resp = await this._fetch(`${this._baseUrl}/v1/live/${this._sessionId}/events`, {
      headers: this._headers({ accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) }),
      signal: this._abort.signal,
    });
    if (resp.status === 404) { this._sessionId = null; throw new Error('AuditorLiveAdapter: the live session is gone (service restarted?)'); }
    if (!resp.ok) throw new Error(`AuditorLiveAdapter: events answered ${resp.status}`);

    let got = false;
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of resp.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let split;
      while ((split = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, '');
        const event = parseFrame(frame);
        if (!event) continue;
        got = true;
        if (event.id) onId(event.id);
        this._handle(event);
      }
    }
    return got;
  }

  _handle({ event, data }) {
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    if (event === 'transcript') {
      const text = (payload.text ?? '').trim();
      if (!text) return;
      this.emit('transcript', {
        text,
        confidence: null,
        timestamp: new Date(payload.wall_start),
        wallStart: payload.wall_start,
        wallEnd: payload.wall_end,
        sequence: payload.sequence,
      });
    } else if (event === 'error') {
      this._report(new Error(`AuditorLiveAdapter: ${payload.message}`));
    } else if (event === 'status' && payload.state === 'ended') {
      this._ended = true;
      if (payload.reason && payload.reason !== 'stopped') {
        this._report(new Error(`AuditorLiveAdapter: the live session ended (${payload.reason}); starting a new one`));
      }
    }
  }
}

function parseFrame(frame) {
  let id = null;
  let event = 'message';
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { id, event, data: data.join('\n') } : null;
}
