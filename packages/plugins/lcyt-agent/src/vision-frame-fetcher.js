/**
 * VisionFrameFetcher (plan_ai_roles_framework.md, Runtime Shape 1 — MVP
 * frame source): polls the backend's already-public preview-JPEG endpoint
 * (`GET /preview/:key/incoming`, PreviewManager in lcyt-rtmp) on a timer —
 * zero new media pipeline, immediately available for every key that
 * already has RTMP relay active.
 *
 * Deliberately HTTP, not an in-process call into lcyt-rtmp: this is exactly
 * the same pattern HlsSegmentFetcher already uses against MediaMTX (a fetch
 * against a URL, no coupling to another plugin's internals) — just with the
 * AI plugin as the consumer instead of the RTMP plugin.
 */

import { EventEmitter } from 'node:events';

const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Local backend server URL, same convention as lcyt-dsk's DSK_LOCAL_SERVER. */
export const DEFAULT_PREVIEW_BASE_URL = process.env.VISION_PREVIEW_BASE_URL
  || `http://localhost:${process.env.PORT || 3000}`;

/**
 * @fires frame — (Buffer) a fetched JPEG frame
 * @fires error — (Error)
 */
export class VisionFrameFetcher extends EventEmitter {
  /**
   * @param {{ apiKey: string, pollIntervalMs?: number, previewBaseUrl?: string }} opts
   */
  constructor({ apiKey, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, previewBaseUrl = DEFAULT_PREVIEW_BASE_URL }) {
    super();
    this._apiKey = apiKey;
    this._pollIntervalMs = pollIntervalMs;
    this._url = `${previewBaseUrl.replace(/\/$/, '')}/preview/${encodeURIComponent(apiKey)}/incoming`;
    this._timer = null;
    this._running = false;
    this._inFlight = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._timer = setInterval(() => this._poll(), this._pollIntervalMs);
    this._poll();
  }

  stop() {
    this._running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  get running() {
    return this._running;
  }

  async _poll() {
    if (this._inFlight) return; // skip if the previous fetch is still in flight
    this._inFlight = true;
    try {
      const res = await fetch(this._url);
      if (res.status === 404) return; // no preview yet for this key — not an error, just nothing to show
      if (!res.ok) throw new Error(`Preview fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      this.emit('frame', buf);
    } catch (err) {
      this.emit('error', err);
    } finally {
      this._inFlight = false;
    }
  }
}
