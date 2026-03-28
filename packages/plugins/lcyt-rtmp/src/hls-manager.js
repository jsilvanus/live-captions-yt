import logger from 'lcyt/logger';
const DEFAULT_MEDIAMTX_HLS_BASE = process.env.MEDIAMTX_HLS_BASE_URL || 'http://127.0.0.1:8080';

/**
 * Manages video+audio HLS streams served by MediaMTX.
 *
 * MediaMTX receives RTMP and serves HLS natively — no ffmpeg process is
 * spawned.  This manager tracks active keys and optionally pre-registers
 * paths with MediaMTX so the server is ready before the publisher arrives.
 *
 * Public API:
 *   start(key)        — register key; optionally pre-create MediaMTX path
 *   stop(key)         — deregister key; optionally remove MediaMTX path
 *   stopAll()         — stop all active keys
 *   isRunning(key)    — true if key was started and not yet stopped
 *
 * HLS proxy URL is served from the backend at /stream-hls/:key/* which
 * proxies to MediaMTX.
 *
 * Environment variables:
 *   MEDIAMTX_HLS_BASE_URL  — MediaMTX HLS server base URL (default: http://127.0.0.1:8080)
 */
export class HlsManager {
  /**
   * @param {{
   *   mediamtxClient?: import('./mediamtx-client.js').MediaMtxClient,
   * }} [opts]
   */
  constructor({ mediamtxClient } = {}) {
    /** @type {Set<string>} */
    this._active = new Set();

    /** @type {import('./mediamtx-client.js').MediaMtxClient | null} */
    this._mediamtx = mediamtxClient ?? null;
  }

  /**
   * Register a key as active. Optionally pre-creates the MediaMTX path so
   * it is ready to accept an ingest stream before the publisher connects.
   *
   * @param {string} hlsKey
   * @returns {Promise<void>}
   */
  async start(hlsKey) {
    const tag = `[hls:${hlsKey.slice(0, 8)}]`;
    if (this._mediamtx) {
      try {
        await this._mediamtx.addPath(hlsKey, { source: 'publisher' });
        logger.info(`${tag} MediaMTX path registered`);
      } catch (err) {
        // Path may already exist; non-fatal
        logger.warn(`${tag} MediaMTX addPath warning: ${err.message}`);
      }
    }
    this._active.add(hlsKey);
    logger.info(`${tag} HLS active (MediaMTX)`);
  }

  /**
   * Deregister a key. Optionally removes the MediaMTX path.
   *
   * @param {string} hlsKey
   * @returns {Promise<void>}
   */
  async stop(hlsKey) {
    if (!this._active.has(hlsKey)) return;
    this._active.delete(hlsKey);

    const tag = `[hls:${hlsKey.slice(0, 8)}]`;
    if (this._mediamtx) {
      try {
        await this._mediamtx.deletePath(hlsKey);
        logger.info(`${tag} MediaMTX path removed`);
      } catch (err) {
        logger.warn(`${tag} MediaMTX deletePath warning: ${err.message}`);
      }
    }
    logger.info(`${tag} HLS stopped`);
  }

  /**
   * Stop all active keys.
   * @returns {Promise<void>}
   */
  async stopAll() {
    await Promise.all([...this._active].map(k => this.stop(k)));
  }

  /**
   * Check whether a key is currently active.
   * @param {string} hlsKey
   * @returns {boolean}
   */
  isRunning(hlsKey) {
    return this._active.has(hlsKey);
  }

  /**
   * Returns the internal MediaMTX HLS base URL for a key (no trailing slash).
   * Used by stream-hls route to proxy when needed.
   *
   * @param {string} hlsKey
   * @returns {string}
   */
  getInternalHlsUrl(hlsKey) {
    const base = DEFAULT_MEDIAMTX_HLS_BASE.replace(/\/$/, '');
    return `${base}/${encodeURIComponent(hlsKey)}`;
  }
}