import { NginxManager } from './nginx-manager.js';
import logger from 'lcyt/logger';

const DEFAULT_MEDIAMTX_HLS_BASE = process.env.MEDIAMTX_HLS_BASE_URL || 'http://127.0.0.1:8080';

/**
 * HLS source backend for the radio pipeline — MediaMTX mode only.
 *
 * MediaMTX receives RTMP and serves HLS natively.  No ffmpeg process is
 * spawned for radio.
 *
 * When NGINX_RADIO_CONFIG_PATH is set, NginxManager writes a nginx location
 * block that proxies the public slug URL to the MediaMTX HLS endpoint,
 * keeping the API key out of public URLs.
 *
 * When nginx integration is disabled, the radio route proxies to MediaMTX
 * via the Node.js backend (/radio/:key/…).
 *
 * Public URL env vars:
 *   MEDIAMTX_HLS_BASE_URL  — MediaMTX HLS server base (default: http://127.0.0.1:8080)
 *   NGINX_RADIO_CONFIG_PATH — path to nginx include file; empty = no-op mode
 */
export class RadioManager {
  /**
   * @param {{
   *   mediamtxClient?: import('./mediamtx-client.js').MediaMtxClient,
   *   nginxManager?:   NginxManager,
   * }} [opts]
   */
  constructor({ mediamtxClient, nginxManager } = {}) {
    /** @type {import('./mediamtx-client.js').MediaMtxClient | null} */
    this._mediamtx = mediamtxClient ?? null;

    /**
     * NginxManager handles writing nginx proxy locations for slug → MediaMTX.
     * When null / no-op, MediaMTX HLS is still accessible via the backend
     * proxy route (/radio/:key/…) at the cost of exposing the API key in the URL.
     *
     * @type {NginxManager}
     */
    this._nginxManager = nginxManager ?? new NginxManager();

    /**
     * Active streams: radioKey → { slug }
     * @type {Map<string, { slug: string }>}
     */
    this._streams = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start HLS for a radio key.
   * Registers the stream with NginxManager and optionally pre-creates the
   * MediaMTX path so it is ready before the publisher arrives.
   *
   * @param {string} radioKey
   * @returns {Promise<void>}
   */
  async start(radioKey) {
    const tag = `[radio:${radioKey.slice(0, 8)}]`;

    if (this._mediamtx) {
      try {
        await this._mediamtx.addPath(radioKey, { source: 'publisher' });
        logger.info(`${tag} MediaMTX path registered`);
      } catch (err) {
        logger.warn(`${tag} MediaMTX addPath warning: ${err.message}`);
      }
    }

    let slug;
    try {
      slug = await this._nginxManager.addStream(radioKey);
      logger.info(`${tag} nginx proxy active → ${this._nginxManager.getPublicUrl(radioKey, '')}`);
    } catch (err) {
      logger.warn(`${tag} nginx update warning: ${err.message}`);
      slug = NginxManager.keyToSlug(radioKey);
    }

    this._streams.set(radioKey, { slug });
  }

  /**
   * Stop HLS for a radio key.
   * Deregisters from NginxManager and optionally removes the MediaMTX path.
   *
   * @param {string} radioKey
   * @returns {Promise<void>}
   */
  async stop(radioKey) {
    if (!this._streams.has(radioKey)) return;
    this._streams.delete(radioKey);

    const tag = `[radio:${radioKey.slice(0, 8)}]`;

    try {
      await this._nginxManager.removeStream(radioKey);
      logger.info(`${tag} nginx proxy removed`);
    } catch (err) {
      logger.warn(`${tag} nginx remove warning: ${err.message}`);
    }

    if (this._mediamtx) {
      try {
        await this._mediamtx.deletePath(radioKey);
        logger.info(`${tag} MediaMTX path removed`);
      } catch (err) {
        logger.warn(`${tag} MediaMTX deletePath warning: ${err.message}`);
      }
    }
  }

  async stopAll() {
    await Promise.all([...this._streams.keys()].map(k => this.stop(k)));
  }

  /** Whether NginxManager is active (slug URLs are served by nginx). */
  get isNginxEnabled() { return this._nginxManager.isEnabled; }

  /**
   * Check whether a radio key is currently live.
   * @param {string} radioKey
   * @returns {boolean}
   */
  isRunning(radioKey) {
    return this._streams.has(radioKey);
  }

  /**
   * Get the public HLS URL for a radio key.
   *
   * When NginxManager is enabled: returns the slug-based nginx URL (/r/:slug/index.m3u8).
   * Otherwise: returns the backend proxy URL (/radio/:key/index.m3u8).
   *
   * @param {string} radioKey
   * @param {string} origin   e.g. "https://api.example.com"
   * @returns {string}
   */
  getPublicHlsUrl(radioKey, origin) {
    if (this._nginxManager.isEnabled) {
      return this._nginxManager.getPublicUrl(radioKey, origin);
    }
    return `${origin}/radio/${radioKey}/index.m3u8`;
  }

  /**
   * Returns the nginx-proxy slug for a radio key.
   * @param {string} radioKey
   * @returns {string}
   */
  getSlug(radioKey) {
    return NginxManager.keyToSlug(radioKey);
  }

  /**
   * Returns the internal MediaMTX HLS URL for a key.
   * Used by the radio route to proxy when nginx is not active.
   *
   * @param {string} radioKey
   * @returns {string}
   */
  getInternalHlsUrl(radioKey) {
    const base = DEFAULT_MEDIAMTX_HLS_BASE.replace(/\/$/, '');
    return `${base}/${encodeURIComponent(radioKey)}`;
  }
}