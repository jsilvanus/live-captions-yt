import { isLocalInstall } from './localMode.js';
import { readPersistedSessionConfig, savePersistedSessionConfig } from './projectSession.js';

/**
 * Local install mode: a tab can hold tokens the backend no longer accepts
 * (e.g. the secrets were regenerated on a redeploy). There is no login page, so
 * sign in as the local admin again, get a fresh project token for the
 * persisted project, and tell the session to reconnect with it.
 *
 * Only ever used for local installs; elsewhere a 401 means "log in again".
 */

export const AUTH_RECOVERED_EVENT = 'lcyt:auth-recovered';

const USER_KEY = 'lcyt-user';
const COOLDOWN_MS = 10_000;

// Tokens that were replaced by a recovery: old -> new (a page may still hold the old one in state).
const replacedTokens = new Map();

let inflight = null;
let lastAttemptAt = 0;
let lastRecoveredAt = 0;

/** True when credentials were renewed a moment ago (callers still holding an old token may retry). */
export function recentlyRecovered(now = Date.now()) {
  return lastRecoveredAt > 0 && now - lastRecoveredAt < COOLDOWN_MS;
}

/** Test hook. */
export function resetAuthRecovery() {
  inflight = null;
  lastAttemptAt = 0;
  lastRecoveredAt = 0;
  replacedTokens.clear();
}

async function renew({ fetchFn, base, storage }) {
  const res = await fetchFn(`${base}/auth/local`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) return false;
  let oldUserToken = null;
  try { oldUserToken = JSON.parse(storage.getItem(USER_KEY) || 'null')?.token || null; } catch { /* none */ }
  if (oldUserToken && oldUserToken !== data.token) replacedTokens.set(oldUserToken, data.token);
  storage.setItem(USER_KEY, JSON.stringify({ token: data.token, backendUrl: base }));

  const cfg = readPersistedSessionConfig(storage);
  if (cfg.projectId) {
    const pr = await fetchFn(`${base}/api/v1/auth/project-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
      body: JSON.stringify({ projectId: cfg.projectId }),
    });
    const pd = await pr.json().catch(() => ({}));
    const projectAccessToken = pd.projectAccessToken || pd.accessToken || pd.token;
    if (pr.ok && projectAccessToken) {
      if (cfg.projectAccessToken && cfg.projectAccessToken !== projectAccessToken) {
        replacedTokens.set(cfg.projectAccessToken, projectAccessToken);
      }
      savePersistedSessionConfig({ ...cfg, projectAccessToken }, storage);
    }
  }
  return true;
}

/**
 * Resolves true when fresh credentials were stored (and `AUTH_RECOVERED_EVENT`
 * dispatched), false when this is not a local install, a renewal just failed
 * (10 s pause, so a dead backend is not hammered), or the backend refused.
 * Concurrent callers share one attempt, and a renewal that happened less than
 * 10 s ago is not repeated (it resolves false: those tokens were just issued,
 * so a new 401 is not a stale-token problem).
 */
export function recoverLocalAuth({
  fetchFn = (...a) => fetch(...a),
  storage = typeof window !== 'undefined' ? window.localStorage : null,
  base = typeof window !== 'undefined' ? window.location.origin : '',
  now = Date.now(),
  notify = true,
} = {}) {
  if (!storage || !isLocalInstall()) return Promise.resolve(false);
  if (inflight) return inflight;
  if (now - lastAttemptAt < COOLDOWN_MS) return Promise.resolve(false);
  lastAttemptAt = now;
  inflight = renew({ fetchFn, base, storage })
    .catch(() => false)
    .then((ok) => {
      inflight = null;
      if (ok) {
        lastRecoveredAt = Date.now();
        if (notify && typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_RECOVERED_EVENT));
      }
      return ok;
    });
  return inflight;
}

const RETRYABLE_BODY = (b) => b == null || typeof b === 'string'
  || (typeof FormData !== 'undefined' && b instanceof FormData)
  || (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams)
  || (typeof Blob !== 'undefined' && b instanceof Blob)
  || b instanceof ArrayBuffer;

/**
 * `fetch` wrapper for local installs: a 401 on an `/api/v1/` call that carried
 * a bearer token the app has since replaced (or can now replace) is retried
 * once with the renewed token. Pages such as Cameras, Mixers, Bridges and the
 * DSK editor hold the stored project token in their own state, so they cannot
 * renew it themselves. Anything else passes through untouched.
 */
export function createLocalAuthFetch(baseFetch, { recover = recoverLocalAuth, isLocal = isLocalInstall } = {}) {
  return async function localAuthFetch(input, init) {
    const res = await baseFetch(input, init);
    if (res.status !== 401) return res;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
    if (!url || !url.includes('/api/v1/') || url.includes('/auth/login') || !isLocal()) return res;
    if (!RETRYABLE_BODY(init?.body)) return res;
    const headers = new Headers(init?.headers || {});
    const sent = /^Bearer\s+(.+)$/i.exec(headers.get('Authorization') || '')?.[1];
    if (!sent) return res;
    await recover();
    const renewed = replacedTokens.get(sent);
    if (!renewed) return res;
    headers.set('Authorization', `Bearer ${renewed}`);
    return baseFetch(input, { ...init, headers });
  };
}

/** Wrap `window.fetch` once (idempotent). */
export function installLocalAuthFetch(target = typeof window !== 'undefined' ? window : null) {
  if (!target || target.fetch?.__lcytLocalAuth) return;
  const wrapped = createLocalAuthFetch(target.fetch.bind(target));
  wrapped.__lcytLocalAuth = true;
  target.fetch = wrapped;
}
