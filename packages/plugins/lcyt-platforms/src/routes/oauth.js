/**
 * Server-side OAuth routes.
 *
 *   GET  /platforms                            list connected accounts
 *   GET  /platforms/:platform/oauth/start      (auth) → redirect to consent
 *   GET  /platforms/:platform/oauth/callback   (public) provider redirect target
 *   POST /platforms/:platform/disconnect       (auth) revoke one account
 *
 * Replaces the browser-only GIS implicit flow this plan retires. That flow
 * could never produce a refresh token, which makes every background feature
 * here — scheduling ahead of time, thumbnail upload, stats polling — impossible
 * without a server-held, auto-refreshing credential.
 */
import { Router } from 'express';
import logger from 'lcyt/logger';
import { createState, verifyState } from '../oauth-state.js';
import { encryptSecret, loadCredentialKey, hasCredentialKey } from '../crypto.js';
import { listCredentials, upsertCredential, getCredential, revokeCredential, maskCredential } from '../db.js';
import { requireApiKey, requireAdapter, respondToPlatformError } from './helpers.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {object} deps
 * @param {() => string} deps.getJwtSecret
 * @param {(platform: string) => {clientId: string, clientSecret: string}} deps.getOAuthConfig
 * @param {(platform: string) => string} deps.getRedirectUri
 * @param {(ok: boolean, detail: object) => string} deps.buildReturnUrl  where to send the browser after the callback
 * @param {ReturnType<import('../token-service.js').createTokenService>} deps.tokenService
 * @param {(platform: string) => object|null} [deps.getAdapter] defaults to the
 *   real registry; injectable so tests can drive behaviour through a double
 *   without weakening platform-support validation
 */
export function createOAuthRouter(db, auth, deps) {
  const { getJwtSecret, getOAuthConfig, getRedirectUri, buildReturnUrl, tokenService, getAdapter } = deps;
  const router = Router();
  const resolveAdapter = (req, res) => requireAdapter(req, res, getAdapter);

  // ── List connected accounts ────────────────────────────────────────────
  // Several rows per platform is the normal case now, not an error.
  router.get('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { platform, includeRevoked } = req.query;
    const rows = listCredentials(db, apiKey, {
      platform: platform || undefined,
      includeRevoked: includeRevoked === '1',
    });
    res.json({
      // Lets the UI explain *why* connecting is unavailable instead of just
      // failing at the first attempt.
      credentialStorageAvailable: hasCredentialKey(),
      credentials: rows.map(maskCredential),
    });
  });

  // ── Begin consent ──────────────────────────────────────────────────────
  router.get('/:platform/oauth/start', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const adapter = resolveAdapter(req, res);
    if (!adapter) return;

    // Refuse before sending the operator to Google: completing consent only to
    // fail at the storage step would be a worse experience than saying so now.
    if (!hasCredentialKey()) {
      return res.status(503).json({
        error: 'PLATFORM_CREDENTIAL_KEY is not configured on this server — platform accounts cannot be stored',
        code: 'no_credential_key',
      });
    }

    let url;
    try {
      const state = createState({ apiKey, platform: adapter.platform }, getJwtSecret());
      url = adapter.buildAuthUrl(state, getRedirectUri(adapter.platform), getOAuthConfig(adapter.platform));
    } catch (err) {
      return respondToPlatformError(res, err, 'Could not build the authorization URL');
    }

    // A JSON body rather than a 302: the caller is fetch() from the SPA, which
    // cannot follow a cross-origin redirect to a consent screen — it has to
    // navigate the top-level window itself.
    if (req.query.redirect === '1') return res.redirect(url);
    res.json({ url });
  });

  // ── Provider redirect target ───────────────────────────────────────────
  // Deliberately NOT behind `auth`: the provider redirects the operator's
  // browser here directly, carrying none of our session. The signed state is
  // the only thing binding this back to a project.
  router.get('/:platform/oauth/callback', async (req, res) => {
    const adapter = resolveAdapter(req, res);
    if (!adapter) return;
    const { code, state, error: providerError } = req.query;

    const fail = (reason, detail) => {
      logger.warn(`[platforms] OAuth callback failed (${adapter.platform}): ${reason}${detail ? ` — ${detail}` : ''}`);
      return res.redirect(buildReturnUrl(false, { platform: adapter.platform, reason }));
    };

    // The user pressed "Cancel" on the consent screen, or the provider refused.
    if (providerError) return fail('denied', String(providerError));
    if (!code || !state) return fail('missing_code');

    const claims = verifyState(String(state), getJwtSecret(), { platform: adapter.platform });
    if (!claims) return fail('bad_state');

    try {
      const redirectUri = getRedirectUri(adapter.platform);
      const cfg = getOAuthConfig(adapter.platform);
      const tokens = await adapter.exchangeCode(String(code), redirectUri, cfg);
      const identity = await adapter.getAccountIdentity(tokens.accessToken);

      const key = loadCredentialKey();
      upsertCredential(db, claims.apiKey, {
        platform: adapter.platform,
        externalAccountId: identity.externalAccountId,
        accountLabel: identity.accountLabel,
        accessTokenEnc: encryptSecret(tokens.accessToken, key),
        refreshTokenEnc: encryptSecret(tokens.refreshToken, key),
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      });

      logger.info(`[platforms] connected ${adapter.platform} account ${identity.accountLabel} (${identity.externalAccountId})`);
      return res.redirect(buildReturnUrl(true, {
        platform: adapter.platform,
        account: identity.accountLabel,
      }));
    } catch (err) {
      return fail('exchange_failed', err.message);
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────────
  router.post('/:platform/disconnect', auth, async (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const adapter = resolveAdapter(req, res);
    if (!adapter) return;

    const { credentialId } = req.body || {};
    if (!credentialId) {
      // No implicit "disconnect the only one" — with multi-channel, guessing
      // which account to drop is exactly the wrong thing to be clever about.
      return res.status(400).json({ error: 'credentialId is required' });
    }
    const row = getCredential(db, apiKey, credentialId);
    if (!row || row.platform !== adapter.platform) {
      return res.status(404).json({ error: 'Platform credential not found' });
    }

    // Best-effort remote revocation, so a disconnected project doesn't leave a
    // live grant sitting in the operator's Google account security settings.
    let remoteRevoked = false;
    if (typeof adapter.revokeToken === 'function') {
      const refreshToken = tokenService.readRefreshToken(row);
      if (refreshToken) remoteRevoked = await adapter.revokeToken(refreshToken);
    }

    const revoked = revokeCredential(db, apiKey, credentialId);

    // The local revocation is what actually stops LCYT using the account, so
    // it always proceeds — but a failed remote revoke is reported rather than
    // papered over, because the operator's Google account still lists us.
    res.json({
      revoked,
      remoteRevoked,
      ...(remoteRevoked ? {} : {
        warning: 'The account was disconnected locally, but the provider did not confirm '
          + 'revocation — you may want to remove access manually in your account settings.',
      }),
    });
  });

  return router;
}
