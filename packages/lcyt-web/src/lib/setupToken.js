/**
 * Bearer token for Setup Hub requests.
 *
 * Setup-tier writes (STT config, storage, radio, tally, ...) are gated by `requireProjectRole(db, 'setup')`,
 * which needs a token that carries a user id. The session token from `POST /live` only holds
 * `{ sessionId, apiKey }`, so it never passes that gate (403 "Explicit project admin/owner access
 * required", also in local mode). The project access token is a user-kind token and does.
 * Falls back to the session token for API-key-only connections (reads still work there).
 *
 * @param {{ projectAccessToken?: string|null, getSessionToken?: () => (string|null) } | null | undefined} session
 * @returns {string|null}
 */
export function setupToken(session) {
  return session?.projectAccessToken || session?.getSessionToken?.() || null;
}
