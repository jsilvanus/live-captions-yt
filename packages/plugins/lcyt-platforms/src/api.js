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
 *   const { poller, tokenService } = initPlatforms(db, { eventBus, getSetting, getJwtSecret, ... });
 *   app.use('/platforms', createPlatformsRouter(db, scopedAuth('platform'), platformDeps));
 *   app.use('/broadcasts/:id/platforms', createBroadcastPlatformsRouter(db, scopedAuth('broadcast'), platformDeps));
 *
 * ORDERING: initPlatforms() must run *after* lcyt-backend's own schema
 * migrations. This plugin's tables carry real foreign keys onto `api_keys` and
 * `broadcasts`, and better-sqlite3 enables `PRAGMA foreign_keys` by default,
 * so creating them against a DB without those parents would fail.
 *
 * DEPENDENCY DIRECTION: this plugin never imports lcyt-backend — it depends on
 * the plugins, not the other way round. Broadcast and caption-target access
 * arrive as injected `broadcastsApi` / `captionTargetsApi` interfaces.
 *
 * See docs/plans/plan_broadcast_platform_sync.md and
 * docs/plans/plan_broadcast_platform_sync_phases.md.
 */
import logger from 'lcyt/logger';
import { runMigrations } from './db.js';
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
 * Run migrations, build the token service, and start the stats poller.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @param {{ publish: Function }} [opts.eventBus]
 * @param {(platform: string) => {clientId: string, clientSecret: string}} [opts.getOAuthConfig]
 * @param {(broadcastId: string) => string|null} [opts.getProjectForBroadcast]
 * @param {() => number} [opts.getIntervalMs]
 * @param {(platform: string) => object|null} [opts.getAdapter]
 * @returns {{ tokenService: object, poller: object }}
 */
export function initPlatforms(db, opts = {}) {
  const {
    eventBus = null,
    getOAuthConfig = () => ({}),
    getProjectForBroadcast = () => null,
    getIntervalMs = () => DEFAULT_INTERVAL_MS,
    getAdapter = registryGetAdapter,
  } = opts;

  runMigrations(db);

  // Warn, don't throw. A server with no key must still boot and serve
  // everything else — only platform connection is unavailable, and the
  // credential write path is what actually refuses.
  if (!hasCredentialKey()) {
    logger.warn(
      '[platforms] PLATFORM_CREDENTIAL_KEY is not set — broadcast platform accounts cannot be connected. '
      + 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  const tokenService = createTokenService({ db, getAdapter, getOAuthConfig });

  const poller = createStatsPoller({
    db,
    getAdapter,
    getAccessToken: (credentialId) => tokenService.getAccessToken(credentialId),
    getProjectForBroadcast,
    eventBus,
    getIntervalMs,
  });
  poller.restore();

  return { tokenService, poller };
}
