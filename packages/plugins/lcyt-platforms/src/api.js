/**
 * lcyt-platforms — Broadcast platform sync plugin entry point.
 *
 * Server-side OAuth, scheduling, thumbnails, go-live/end and viewer stats for
 * external streaming platforms, tied to the `broadcasts` entity. YouTube is
 * fully implemented; Facebook Live exists only as a non-wired adapter skeleton
 * (see adapters/facebook.js).
 *
 * Usage in lcyt-backend:
 *   import { initPlatforms, createPlatformsRouter, createBroadcastPlatformsRouter } from 'lcyt-platforms';
 *   const { poller, tokenService } = await initPlatforms(db, { eventBus, getSetting, getJwtSecret, ... });
 *   app.use('/platforms', createPlatformsRouter(db, scopedAuth('platform'), platformDeps));
 *   app.use('/broadcasts/:id/platforms', createBroadcastPlatformsRouter(db, scopedAuth('broadcast'), platformDeps));
 *
 * The tables (with real foreign keys onto `api_keys` and `broadcasts`) come
 * from the lcyt-backend schema; this plugin creates nothing itself.
 *
 * DEPENDENCY DIRECTION: this plugin never imports lcyt-backend — it depends on
 * the plugins, not the other way round. Broadcast and caption-target access
 * arrive as injected `broadcastsApi` / `captionTargetsApi` interfaces.
 *
 * See docs/plans/plan_broadcast_platform_sync.md and
 * docs/plans/plan_broadcast_platform_sync_phases.md.
 */
import logger from 'lcyt/logger';
import { hasCredentialKey } from './crypto.js';
import { createTokenService } from './token-service.js';
import { createStatsPoller, DEFAULT_INTERVAL_MS } from './stats-poller.js';
import { getAdapter as registryGetAdapter } from './adapters/index.js';

export * from './db.js';
export {
  encryptSecret, decryptSecret, loadCredentialKey, hasCredentialKey,
  generateCredentialKey, CredentialKeyError,
} from './crypto.js';
export { createState, verifyState, STATE_TTL_MS } from './oauth-state.js';
export { createTokenService, CredentialUnusableError } from './token-service.js';
export { createStatsPoller, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS } from './stats-poller.js';
export { getAdapter, isSupportedPlatform, SUPPORTED_PLATFORMS } from './adapters/index.js';
export { assertAdapterShape } from './adapters/base.js';
export { createOAuthRouter } from './routes/oauth.js';
export { createBroadcastPlatformsRouter } from './routes/broadcast-platforms.js';

/**
 * Build the token service and start the stats poller.
 *
 * @param {import('lcyt-backend/db').Db} db
 * @param {object} [opts]
 * @param {{ publish: Function }} [opts.eventBus]
 * @param {(platform: string) => {clientId: string, clientSecret: string}} [opts.getOAuthConfig]
 * @param {(broadcastId: string) => string|null|Promise<string|null>} [opts.getProjectForBroadcast]
 * @param {() => number} [opts.getIntervalMs]
 * @param {(platform: string) => object|null} [opts.getAdapter]
 * @returns {Promise<{ tokenService: object, poller: object }>}
 */
export async function initPlatforms(db, opts = {}) {
  const {
    eventBus = null,
    getOAuthConfig = () => ({}),
    getProjectForBroadcast = () => null,
    getIntervalMs = () => DEFAULT_INTERVAL_MS,
    getAdapter = registryGetAdapter,
    leases = null,
  } = opts;

  // Warn, don't throw. A server with no key must still boot and serve
  // everything else — only platform connection is unavailable, and the
  // credential write path is what actually refuses.
  if (!hasCredentialKey()) {
    logger.warn(
      '[platforms] PLATFORM_CREDENTIAL_KEY is not set — broadcast platform accounts cannot be connected. '
      + 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  const tokenService = createTokenService({ db, getAdapter, getOAuthConfig, leases });

  const poller = createStatsPoller({
    db,
    getAdapter,
    getAccessToken: (credentialId) => tokenService.getAccessToken(credentialId),
    getProjectForBroadcast,
    eventBus,
    getIntervalMs,
    leases,
  });
  await poller.restore();

  return { tokenService, poller };
}
