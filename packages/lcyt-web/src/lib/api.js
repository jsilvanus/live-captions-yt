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

  return {
    get:  (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body, parseErrorBody: true }),
    put:  (path, body) => request(path, { method: 'PUT', body, parseErrorBody: true }),
    del:  (path, { parseErrorBody = false } = {}) => request(path, { method: 'DELETE', parseErrorBody }),
  };
}
