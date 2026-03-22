/**
 * MediaMtxClient — thin REST client for the MediaMTX HTTP API (v3).
 *
 * MediaMTX exposes a JSON REST API on its API port (default :9997, separate from the
 * HLS/metrics HTTP port on :8080). This client wraps the operations used by lcyt-rtmp:
 *
 *   kickPath(name)      — drop a publisher from a named path
 *                         (equivalent to nginx-rtmp `drop/publisher`)
 *   getPath(name)       — get info about a path (publisher state, reader count, etc.)
 *   isPathPublishing(n) — check whether a path currently has an active publisher
 *   listPaths()         — list all paths tracked by MediaMTX
 *   addPath(name, cfg)  — dynamically add a path configuration
 *   deletePath(name)    — remove a dynamically-added path configuration
 *
 * Authentication:
 *   MediaMTX supports HTTP Basic Auth on its API port. Provide credentials via
 *   `user` / `password` constructor options or the MEDIAMTX_API_USER /
 *   MEDIAMTX_API_PASSWORD environment variables.
 *
 * Environment variables (all optional — defaults are sufficient for local dev):
 *   MEDIAMTX_API_URL      — Base URL of the MediaMTX API server (default: http://localhost:9997)
 *   MEDIAMTX_API_USER     — Basic-auth username
 *   MEDIAMTX_API_PASSWORD — Basic-auth password
 *
 * @example
 *   const client = new MediaMtxClient({ baseUrl: 'http://mediamtx:9997' });
 *
 *   // Drop a publisher (e.g. when the user calls DELETE /stream):
 *   await client.kickPath('myapikey');
 *
 *   // Check whether a stream is live:
 *   const live = await client.isPathPublishing('myapikey');
 *
 *   // Dynamically add a path so MediaMTX accepts ingest before the publisher arrives:
 *   await client.addPath('myapikey', { source: 'publisher' });
 *
 *   // Clean up after the stream ends:
 *   await client.deletePath('myapikey');
 */
export class MediaMtxClient {
  /**
   * @param {{
   *   baseUrl?:  string,   // MediaMTX API base URL (default: $MEDIAMTX_API_URL or http://localhost:9997)
   *   user?:     string,   // Basic-auth username   (default: $MEDIAMTX_API_USER)
   *   password?: string,   // Basic-auth password   (default: $MEDIAMTX_API_PASSWORD)
   * }} [opts]
   */
  constructor(opts = {}) {
    this._baseUrl = (opts.baseUrl ?? process.env.MEDIAMTX_API_URL ?? 'http://localhost:9997')
      .replace(/\/$/, '');

    const user     = opts.user     ?? process.env.MEDIAMTX_API_USER     ?? null;
    const password = opts.password ?? process.env.MEDIAMTX_API_PASSWORD ?? null;
    this._authHeader = (user && password)
      ? `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
      : null;
  }

  // ---------------------------------------------------------------------------
  // Path operations
  // ---------------------------------------------------------------------------

  /**
   * Kick all publishers and readers of a named path.
   * Equivalent to nginx-rtmp `POST /control/drop/publisher?app=...&name=...`.
   *
   * @param {string} name  Path name (= stream key / API key)
   * @returns {Promise<void>}
   */
  async kickPath(name) {
    await this._request('POST', `/v3/paths/kick/${encodeURIComponent(name)}`);
  }

  /**
   * Get the current state of a named path.
   *
   * Returns a MediaMTX path object with fields such as:
   *   { name, ready, readyTime, tracks, bytesReceived, bytesSent, readers }
   *
   * @param {string} name
   * @returns {Promise<object>}
   * @throws {MediaMtxApiError} with statusCode 404 if the path does not exist
   */
  async getPath(name) {
    return this._request('GET', `/v3/paths/get/${encodeURIComponent(name)}`);
  }

  /**
   * Check whether the named path currently has an active publisher.
   * Returns false (rather than throwing) if the path is not found.
   *
   * @param {string} name
   * @returns {Promise<boolean>}
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

  /**
   * List all paths tracked by MediaMTX.
   *
   * @returns {Promise<{ itemCount: number, pageCount: number, items: object[] }>}
   */
  async listPaths() {
    return this._request('GET', '/v3/paths/list');
  }

  // ---------------------------------------------------------------------------
  // Path configuration (dynamic paths)
  // ---------------------------------------------------------------------------

  /**
   * Dynamically add a path to the MediaMTX running configuration.
   * The path is created in memory (not persisted to mediamtx.yml).
   *
   * Useful to pre-create a path so MediaMTX accepts an ingest stream
   * as soon as the publisher connects.
   *
   * @param {string} name
   * @param {object} [config]  MediaMTX path options (see mediamtx.yml paths section).
   *                           Omit to use server defaults.
   * @returns {Promise<void>}
   */
  async addPath(name, config = {}) {
    await this._request('POST', `/v3/config/paths/add/${encodeURIComponent(name)}`, config);
  }

  /**
   * Fetch a JPEG thumbnail snapshot for the named path.
   *
   * Returns the raw fetch Response so the caller can pipe the body directly
   * to an HTTP response. Returns null if the path is not found or has no
   * active publisher (HTTP 404).
   *
   * @param {string} name
   * @returns {Promise<Response | null>}
   * @throws {MediaMtxApiError} on non-404 errors
   */
  async getThumbnail(name) {
    const url = `${this._baseUrl}/v3/paths/${encodeURIComponent(name)}/thumbnail`;
    const headers = { Accept: 'image/jpeg, */*' };
    if (this._authHeader) headers.Authorization = this._authHeader;

    let res;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (networkErr) {
      throw new MediaMtxApiError(
        `MediaMTX thumbnail request failed (${name}): ${networkErr.message}`,
        0,
      );
    }

    if (res.status === 404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new MediaMtxApiError(
        `MediaMTX GET thumbnail/${name} → HTTP ${res.status}: ${text.slice(0, 200)}`,
        res.status,
      );
    }

    return res;
  }

  /**
   * Remove a dynamically-added path from the running configuration.
   * No-op if the path does not exist.
   *
   * @param {string} name
   * @returns {Promise<void>}
   */
  async deletePath(name) {
    try {
      await this._request('DELETE', `/v3/config/paths/delete/${encodeURIComponent(name)}`);
    } catch (err) {
      if (err instanceof MediaMtxApiError && err.statusCode === 404) return;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Perform a JSON API request.
   *
   * @param {string} method   HTTP method
   * @param {string} path     URL path (must start with /)
   * @param {object} [body]   JSON request body (POST/PATCH only)
   * @returns {Promise<object|string>}
   */
  async _request(method, path, body) {
    const url  = `${this._baseUrl}${path}`;
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
        `MediaMTX API request failed (${method} ${path}): ${networkErr.message}`,
        0,
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

/**
 * Error thrown by MediaMtxClient when the API returns a non-2xx response
 * or a network-level failure occurs.
 */
export class MediaMtxApiError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode  HTTP status code (0 for network errors)
   */
  constructor(message, statusCode) {
    super(message);
    this.name = 'MediaMtxApiError';
    /** @type {number} HTTP status code; 0 for network-level failures */
    this.statusCode = statusCode;
  }
}
