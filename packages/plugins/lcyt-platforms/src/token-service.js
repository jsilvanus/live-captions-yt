/**
 * Access-token lifecycle.
 *
 * Every adapter call goes through `getAccessToken()`, which decrypts the
 * stored token and refreshes it if it is close to expiry. There is no separate
 * refresh scheduler — at this scale a lazy refresh on use is both simpler and
 * strictly more correct, since a credential nobody touches doesn't need a live
 * token.
 *
 * Two things this exists to prevent:
 *
 *  1. **Concurrent double-refresh.** The stats poller ticking and an operator
 *     hitting "Go Live" can land on the same expired credential at the same
 *     moment. Two refreshes race, both write, and with a provider that rotates
 *     refresh tokens the loser's token is already invalid. A per-credential
 *     in-flight promise collapses them into one.
 *  2. **Silent use of a revoked credential.** Revocation is a soft delete, so
 *     the row is still readable; this refuses it explicitly rather than
 *     letting a caller sail on with a token the operator thought they'd
 *     disconnected.
 */
import { NetworkError } from 'lcyt/errors';
import { decryptSecret, encryptSecret, loadCredentialKey } from './crypto.js';
import { getCredentialById, updateCredentialTokens } from './db.js';

/** Refresh this far ahead of the real expiry, so a token can't die mid-request. */
export const REFRESH_SKEW_MS = 60_000;

/**
 * Raised when a credential can no longer be used and the operator has to
 * reconnect. Distinct from a transient NetworkError so routes can say
 * "reconnect this account" rather than "try again".
 */
export class CredentialUnusableError extends Error {
  constructor(message, { credentialId = null, reason = null } = {}) {
    super(message);
    this.name = 'CredentialUnusableError';
    this.credentialId = credentialId;
    this.reason = reason;
  }
}

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {(platform: string) => object|null} deps.getAdapter
 * @param {() => object} deps.getOAuthConfig  called per refresh so a settings
 *   change takes effect without a restart
 * @param {() => Buffer} [deps.getKey]        injectable for tests
 */
export function createTokenService({ db, getAdapter, getOAuthConfig, getKey = loadCredentialKey }) {
  /** @type {Map<string, Promise<string>>} credentialId -> in-flight refresh */
  const inFlight = new Map();

  /**
   * @param {string} expiresAt ISO, no trailing Z (repo convention)
   * @param {number} now epoch ms
   */
  function isExpiring(expiresAt, now) {
    const ts = Date.parse(expiresAt?.endsWith('Z') ? expiresAt : `${expiresAt}Z`);
    // An unparseable expiry is treated as expired rather than as "never
    // expires" — refreshing unnecessarily is cheap, using a dead token is not.
    if (Number.isNaN(ts)) return true;
    return ts - now <= REFRESH_SKEW_MS;
  }

  async function doRefresh(row, key) {
    const adapter = getAdapter(row.platform);
    if (!adapter) {
      throw new CredentialUnusableError(`No adapter for platform '${row.platform}'`, {
        credentialId: row.id, reason: 'unsupported_platform',
      });
    }

    let refreshToken;
    try {
      refreshToken = decryptSecret(row.refresh_token_enc, key);
    } catch {
      // Almost always means PLATFORM_CREDENTIAL_KEY changed — the plan
      // documents rotation as unbuilt, and this is what that costs.
      throw new CredentialUnusableError(
        'Stored credential could not be decrypted — PLATFORM_CREDENTIAL_KEY may have changed; reconnect the account',
        { credentialId: row.id, reason: 'undecryptable' },
      );
    }

    let tokens;
    try {
      tokens = await adapter.refreshAccessToken(refreshToken, getOAuthConfig());
    } catch (err) {
      // A 400/401 from the token endpoint means the grant is gone for good
      // (user revoked it in their Google account, or the app was removed).
      if (err instanceof NetworkError && (err.statusCode === 400 || err.statusCode === 401)) {
        throw new CredentialUnusableError(
          `Refresh was rejected by ${row.platform} — the account must be reconnected`,
          { credentialId: row.id, reason: 'grant_revoked' },
        );
      }
      throw err;
    }

    updateCredentialTokens(db, row.id, {
      accessTokenEnc: encryptSecret(tokens.accessToken, key),
      expiresAt: tokens.expiresAt,
    });
    return tokens.accessToken;
  }

  /**
   * Decrypt (and refresh if needed) the access token for a credential.
   *
   * @param {string} credentialId
   * @param {{ now?: number, forceRefresh?: boolean }} [opts]
   * @returns {Promise<string>}
   */
  async function getAccessToken(credentialId, { now = Date.now(), forceRefresh = false } = {}) {
    const row = getCredentialById(db, credentialId);
    if (!row) {
      throw new CredentialUnusableError('Platform credential not found', { credentialId, reason: 'missing' });
    }
    if (row.revoked_at) {
      throw new CredentialUnusableError('Platform credential has been disconnected', {
        credentialId, reason: 'revoked',
      });
    }

    const key = getKey();

    if (!forceRefresh && !isExpiring(row.expires_at, now)) {
      try {
        return decryptSecret(row.access_token_enc, key);
      } catch {
        // Fall through to a refresh — a bad access-token blob is recoverable
        // if the refresh token still decrypts.
      }
    }

    const existing = inFlight.get(credentialId);
    if (existing) return existing;

    const promise = doRefresh(row, key).finally(() => inFlight.delete(credentialId));
    inFlight.set(credentialId, promise);
    return promise;
  }

  /**
   * Decrypt the refresh token — only for disconnect, which has to hand it to
   * the provider's revocation endpoint. Deliberately separate from
   * getAccessToken so the refresh token is never fetched incidentally.
   * @param {object} row a platform_credentials row
   * @returns {string|null} null when it cannot be decrypted (nothing to revoke remotely)
   */
  function readRefreshToken(row) {
    try {
      return decryptSecret(row.refresh_token_enc, getKey());
    } catch {
      return null;
    }
  }

  return { getAccessToken, readRefreshToken, isExpiring };
}
