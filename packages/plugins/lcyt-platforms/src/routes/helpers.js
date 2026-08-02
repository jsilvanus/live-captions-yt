/**
 * Shared route helpers for lcyt-platforms' Express routers.
 *
 * Duplicated from lcyt-connectors' equivalent rather than shared: lcyt-backend
 * depends on both plugins, so a plugin cannot depend back on it without a
 * circular dependency, and plugins don't depend on each other. Same unavoidable
 * duplication that package boundary creates elsewhere in this repo.
 */
import { getAdapter, isSupportedPlatform, SUPPORTED_PLATFORMS } from '../adapters/index.js';
import { getDefaultCredential, getCredential } from '../db.js';

/**
 * Reads `req.session.apiKey` (set by lcyt-backend's project auth middleware),
 * 401ing if absent.
 * @returns {string|null}
 */
export function requireApiKey(req, res) {
  const apiKey = req.session?.apiKey;
  if (!apiKey) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return apiKey;
}

/**
 * Resolve `:platform` to a registered adapter, 404ing otherwise.
 *
 * `facebook` lands here as unsupported — the skeleton adapter exists but is
 * deliberately unregistered, so it is unreachable rather than half-working.
 *
 * Support is always decided by the real registry; only the returned adapter
 * *object* comes from `resolve`. That split lets tests drive route behaviour
 * through a double without also weakening the "facebook is unreachable"
 * guarantee they are meant to be checking.
 *
 * @param {(platform: string) => object|null} [resolve]
 * @returns {object|null}
 */
export function requireAdapter(req, res, resolve = getAdapter) {
  const { platform } = req.params;
  if (!isSupportedPlatform(platform)) {
    res.status(404).json({
      error: `Unsupported platform '${platform}'`,
      supported: SUPPORTED_PLATFORMS,
    });
    return null;
  }
  const adapter = resolve(platform);
  if (!adapter) {
    res.status(500).json({ error: `No adapter available for '${platform}'` });
    return null;
  }
  return adapter;
}

/**
 * Pick the credential a request should act under.
 *
 * Multi-channel (resolved decision #1) makes "the project's YouTube account"
 * ambiguous as soon as a second channel is connected, so an explicit
 * `credentialId` always wins and the implicit path only resolves when there is
 * exactly one live account. The ambiguous case returns 409 with the candidate
 * list, which is enough for a client to render a picker without a second
 * round-trip.
 *
 * @returns {object|null} a platform_credentials row, or null after responding
 */
export function resolveCredential(req, res, db, apiKey, platform) {
  const credentialId = req.body?.credentialId || req.query?.credentialId;

  if (credentialId) {
    const row = getCredential(db, apiKey, credentialId);
    if (!row) {
      res.status(404).json({ error: 'Platform credential not found' });
      return null;
    }
    if (row.platform !== platform) {
      res.status(400).json({ error: `Credential belongs to '${row.platform}', not '${platform}'` });
      return null;
    }
    if (row.revoked_at) {
      res.status(409).json({ error: 'That account has been disconnected — reconnect it first' });
      return null;
    }
    return row;
  }

  const resolved = getDefaultCredential(db, apiKey, platform);
  if (resolved.ok) return resolved.credential;

  if (resolved.reason === 'none') {
    res.status(409).json({
      error: `No ${platform} account is connected to this project`,
      code: 'not_connected',
    });
    return null;
  }
  res.status(409).json({
    error: `This project has several ${platform} accounts connected — specify credentialId`,
    code: 'ambiguous_credential',
    candidates: resolved.candidates,
  });
  return null;
}

/**
 * Turn an adapter/token-service failure into a response.
 *
 * Collapses three distinct situations that would otherwise all read as "500":
 * a credential the operator must reconnect, a provider rejection with its own
 * status, and everything else.
 */
export function respondToPlatformError(res, err, fallback = 'Platform request failed') {
  if (err?.name === 'CredentialUnusableError') {
    return res.status(409).json({
      error: err.message,
      code: 'credential_unusable',
      reason: err.reason,
    });
  }
  if (err?.name === 'NetworkError' && err.statusCode) {
    // 401 from the provider after a successful refresh means the grant itself
    // is gone; surface it as a reconnect prompt, not a transient failure.
    const status = err.statusCode === 401 ? 409 : (err.statusCode === 403 ? 403 : 502);
    return res.status(status).json({
      error: err.message,
      code: err.reason || (err.statusCode === 401 ? 'credential_unusable' : 'platform_error'),
      upstreamStatus: err.statusCode,
    });
  }
  return res.status(500).json({ error: err?.message || fallback });
}
