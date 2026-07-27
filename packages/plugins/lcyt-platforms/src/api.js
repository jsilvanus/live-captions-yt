/**
 * lcyt-platforms — Broadcast platform sync plugin entry point.
 *
 * Server-side OAuth, scheduling, thumbnails, go-live/end and viewer stats for
 * external streaming platforms, tied to the `broadcasts` entity. YouTube is
 * fully implemented; Facebook Live exists only as a non-wired adapter skeleton
 * (see adapters/facebook.js).
 *
 * Usage in lcyt-backend:
 *   import { initPlatforms, createPlatformsRouter } from 'lcyt-platforms';
 *   const { poller } = initPlatforms(db, { eventBus, settings });
 *   app.use('/platforms', createPlatformsRouter(db, scopedAuth('platform'), { poller, ... }));
 *
 * ORDERING: initPlatforms() must run *after* lcyt-backend's own schema
 * migrations. This plugin's tables carry real foreign keys onto `api_keys` and
 * `broadcasts`, and better-sqlite3 enables `PRAGMA foreign_keys` by default,
 * so creating them against a DB without those parents would fail.
 *
 * See docs/plans/plan_broadcast_platform_sync.md and
 * docs/plans/plan_broadcast_platform_sync_phases.md.
 */
import { runMigrations } from './db.js';

export * from './db.js';
export {
  encryptSecret, decryptSecret, loadCredentialKey, hasCredentialKey,
  generateCredentialKey, CredentialKeyError,
} from './crypto.js';

/**
 * Run the plugin's migrations. Background services and routers are wired in
 * later phases of plan_broadcast_platform_sync_phases.md.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @returns {{ }}
 */
export function initPlatforms(db, opts = {}) {
  runMigrations(db);
  return {};
}
