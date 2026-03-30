import logger from 'lcyt/logger';
const DEFAULT_WEBRTC_BASE = (process.env.MEDIAMTX_WEBRTC_BASE_URL || 'http://127.0.0.1:8889').replace(/\/$/, '');

/**
 * Manages stream preview access via MediaMTX.
 *
 * MediaMTX exposes three preview types for any receiving path:
 *
 *   Thumbnail (JPEG)  — GET {API_URL}/v3/paths/{name}/thumbnail
 *                        Low-overhead static snapshot; served via /preview/:key/incoming.jpg
 *
 *   WebRTC (live)     — {MEDIAMTX_WEBRTC_BASE_URL}/{name}
 *                        Low-latency live preview; URL returned by /preview/:key/webrtc
 *
 *   HLS               — /stream-hls/:key/index.m3u8 (existing, via HlsManager proxy)
 *
 * No ffmpeg processes or files are managed by this class. start()/stop() track
 * which keys are considered active so isRunning() can be queried synchronously.
 *
 * Public API:
 *   start(key)           — mark key as active (called on publish)
 *   stop(key)            — mark key as inactive (called on publish_done)
 *   stopAll()            — clear all active keys
 *   isRunning(key)       — true if key is currently active
 *   fetchThumbnail(key, { width?, height? })  — fetch JPEG snapshot from MediaMTX; returns Response or null
 *   getWebRtcUrl(key)    — return the MediaMTX WebRTC URL for the key
 *
 * Environment variables:
 *   MEDIAMTX_WEBRTC_BASE_URL  — MediaMTX WebRTC base URL (default: http://127.0.0.1:8889)
 *   MEDIAMTX_API_URL          — MediaMTX API base URL (used by MediaMtxClient for thumbnails)
 */
export class PreviewManager {
  /**
   * @param {{
   *   mediamtxClient?: import('./mediamtx-client.js').MediaMtxClient,
   *   webrtcBase?:     string,
   * }} [opts]
   */
  constructor({ mediamtxClient, webrtcBase } = {}) {
    /** @type {import('./mediamtx-client.js').MediaMtxClient | null} */
    this._mediamtx = mediamtxClient ?? null;

    this._webrtcBase = (webrtcBase ?? DEFAULT_WEBRTC_BASE).replace(/\/$/, '');

    /** @type {Set<string>} */
    this._active = new Set();
  }

  /**
   * Mark a key as active (called when a publisher connects).
   * @param {string} key
   * @returns {Promise<void>}
   */
  start(key) {
    this._active.add(key);
    return Promise.resolve();
  }

  /**
   * Mark a key as inactive (called when the publisher disconnects).
   * @param {string} key
   * @returns {Promise<void>}
   */
  stop(key) {
    this._active.delete(key);
    return Promise.resolve();
  }

  /**
   * Clear all active keys.
   * @returns {Promise<void>}
   */
  stopAll() {
    this._active.clear();
    return Promise.resolve();
  }

  /**
   * Check whether a key is currently active.
   * @param {string} key
   * @returns {boolean}
   */
  isRunning(key) {
    return this._active.has(key);
  }

  /**
   * Fetch a JPEG thumbnail snapshot for the key from the MediaMTX API.
   *
   * Returns the raw fetch Response (caller pipes the body to the HTTP response)
   * or null if MediaMTX returns 404 (path not found / not publishing) or if no
   * MediaMtxClient is configured.
   *
   * Pass `width` and/or `height` to request a downscaled snapshot from MediaMTX
   * server-side — no extra process is spawned. Useful when feeding the image to
   * an AI vision API (e.g. 640 wide is sufficient for most models and cuts
   * bytes-transferred by ~4–8× vs. full HD).
   *
   * @param {string} key
   * @param {{ width?: number, height?: number }} [opts]
   * @returns {Promise<Response | null>}
   */
  async fetchThumbnail(key, { width, height } = {}) {
    if (!this._mediamtx) return null;
    try {
      return await this._mediamtx.getThumbnail(key, { width, height });
    } catch (err) {
      logger.warn(`[preview:${key.slice(0, 8)}] thumbnail fetch error: ${err.message}`);
      return null;
    }
  }

  /**
   * Return the MediaMTX WebRTC URL for the key.
   * Clients can open this URL directly in a browser or embed it in a WebRTC player.
   *
   * @param {string} key
   * @returns {string}
   */
  getWebRtcUrl(key) {
    return `${this._webrtcBase}/${encodeURIComponent(key)}`;
  }
}