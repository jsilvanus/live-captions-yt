/**
 * Authenticated fetch helper for the lcyt backend API.
 *
 * Eliminates repetitive token-check + fetch + error-handling boilerplate
 * used throughout useSession.js.
 *
 * @param {import('react').RefObject} senderRef  — ref to the BackendCaptionSender instance
 * @param {import('react').RefObject} backendUrlRef — ref to the current backend URL string
 */
export function createApi(senderRef, backendUrlRef) {
  /**
   * Low-level authenticated fetch.  Throws if no token is available or
   * the response is not ok.  When `parseErrorBody` is true (default for
   * mutating requests) the server's JSON error message is used in the
   * thrown Error.
   */
  async function request(path, { method = 'GET', body, parseErrorBody = false } = {}) {
    const token = senderRef.current?._token;
    if (!token) throw new Error('Not connected');
    const url = backendUrlRef.current;

    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${url}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      if (parseErrorBody) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      throw new Error(`Request failed (${res.status})`);
    }

    return res.json();
  }

  /** @type {Map<string, { data: unknown, fetchedAt: number }>} */
  const _cache = new Map();

  /**
   * GET with in-memory short-circuit caching.
   *
   * Returns cached data if it was fetched within `maxAgeMs` milliseconds.
   * Otherwise fetches fresh and stores the result.  Use this for config and
   * feature-flag endpoints that rarely change so repeated calls in the same
   * session don't hit the backend every time.
   *
   * @param {string}  path      API path (e.g. '/stt/config')
   * @param {number}  maxAgeMs  Cache TTL in milliseconds (default 30 s)
   * @returns {Promise<unknown>}
   */
  async function getCached(path, maxAgeMs = 30_000) {
    const entry = _cache.get(path);
    if (entry && Date.now() - entry.fetchedAt < maxAgeMs) {
      return entry.data;
    }
    const data = await request(path);
    _cache.set(path, { data, fetchedAt: Date.now() });
    return data;
  }

  /**
   * Evict one or more cache entries by exact path or path prefix.
   *
   * Call this after any PUT/POST/DELETE that modifies a cached resource so
   * the next GET fetches fresh data.
   *
   * @param {string} pathOrPrefix  Exact path or prefix to evict (e.g. '/stt/config')
   */
  function invalidate(pathOrPrefix) {
    for (const key of _cache.keys()) {
      if (key === pathOrPrefix || key.startsWith(pathOrPrefix)) {
        _cache.delete(key);
      }
    }
  }

  return {
    get:        (path) => request(path),
    getCached,
    invalidate,
    post:       (path, body) => request(path, { method: 'POST', body, parseErrorBody: true }),
    put:        (path, body) => request(path, { method: 'PUT', body, parseErrorBody: true }),
    del:        (path, { parseErrorBody = false } = {}) => request(path, { method: 'DELETE', parseErrorBody }),
  };
}
