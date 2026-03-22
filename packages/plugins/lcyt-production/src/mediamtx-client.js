/**
 * MediaMtxClient — thin REST client for the MediaMTX HTTP API (v3).
 *
 * Copied from packages/plugins/lcyt-rtmp/src/mediamtx-client.js to
 * avoid a cross-plugin dependency. Keep in sync if that file changes.
 *
 * Used by production-control routes to:
 *   - Check whether a camera path is live (isPathPublishing)
 *   - Drop a publisher on WHIP session end (kickPath)
 *   - Pre-register paths so MediaMTX accepts ingest early (addPath)
 *
 * Environment variables (all optional):
 *   MEDIAMTX_API_URL          — API base URL         (default: http://localhost:9997)
 *   MEDIAMTX_WEBRTC_BASE_URL  — WebRTC / WHIP base   (default: http://127.0.0.1:8889)
 *   MEDIAMTX_API_USER         — Basic-auth username
 *   MEDIAMTX_API_PASSWORD     — Basic-auth password
 */
export class MediaMtxClient {
  /**
   * @param {{
   *   baseUrl?:      string,
   *   webrtcBaseUrl?: string,
   *   user?:         string,
   *   password?:     string,
   * }} [opts]
   */
  constructor(opts = {}) {
    this._baseUrl = (opts.baseUrl ?? process.env.MEDIAMTX_API_URL ?? 'http://localhost:9997')
      .replace(/\/$/, '');

    this._webrtcBaseUrl = (opts.webrtcBaseUrl ?? process.env.MEDIAMTX_WEBRTC_BASE_URL ?? 'http://127.0.0.1:8889')
      .replace(/\/$/, '');

    const user     = opts.user     ?? process.env.MEDIAMTX_API_USER     ?? null;
    const password = opts.password ?? process.env.MEDIAMTX_API_PASSWORD ?? null;
    this._authHeader = (user && password)
      ? `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
      : null;
  }

  /** Base URL for WebRTC WHIP signaling (e.g. http://127.0.0.1:8889) */
  get webrtcBaseUrl() {
    return this._webrtcBaseUrl;
  }

  /** Kick all publishers and readers of a named path. */
  async kickPath(name) {
    await this._request('POST', `/v3/paths/kick/${encodeURIComponent(name)}`);
  }

  /** Get the current state of a named path. */
  async getPath(name) {
    return this._request('GET', `/v3/paths/get/${encodeURIComponent(name)}`);
  }

  /**
   * Check whether the named path currently has an active publisher.
   * Returns false (rather than throwing) if the path is not found.
   */
  async isPathPublishing(name) {
    try {
      const path = await this.getPath(name);
      return path?.ready === true;
    } catch (err) {
      if (err instanceof MediaMtxApiError && err.statusCode === 404) return false;
      throw err;
    }
  }

  /** List all paths tracked by MediaMTX. */
  async listPaths() {
    return this._request('GET', '/v3/paths/list');
  }

  /** Dynamically add a path to the running configuration. */
  async addPath(name, config = {}) {
    await this._request('POST', `/v3/config/paths/add/${encodeURIComponent(name)}`, config);
  }

  /** Remove a dynamically-added path. No-op if path does not exist. */
  async deletePath(name) {
    try {
      await this._request('DELETE', `/v3/config/paths/delete/${encodeURIComponent(name)}`);
    } catch (err) {
      if (err instanceof MediaMtxApiError && err.statusCode === 404) return;
      throw err;
    }
  }

  async _request(method, path, body) {
    const url     = `${this._baseUrl}${path}`;
    const headers = { Accept: 'application/json' };
    if (this._authHeader) headers.Authorization = this._authHeader;

    const opts = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, opts);
    } catch (networkErr) {
      throw new MediaMtxApiError(
        `MediaMTX API request failed (${method} ${path}): ${networkErr.message}`, 0,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new MediaMtxApiError(
        `MediaMTX API ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`,
        res.status,
      );
    }

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return res.text();
    return res.json();
  }
}

export class MediaMtxApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'MediaMtxApiError';
    this.statusCode = statusCode;
  }
}
