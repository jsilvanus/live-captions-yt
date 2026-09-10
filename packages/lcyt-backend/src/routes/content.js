/**
 * Content router group — analytics, files, media, and auxiliary endpoints.
 *
 * Mounts: /stats, /usage, /file, /viewer, /video, /stt, /targets,
 *         /broadcasts (+ /broadcasts/:id/platforms), /videos,
 *         /translation, /bridge-download
 *
 * The old /youtube router is gone: its single route handed the browser a
 * client ID for the implicit-token flow, which plan_broadcast_platform_sync.md
 * replaces with server-side OAuth under /platforms.
 */
import { Router } from 'express';
import { createBroadcastPlatformsRouter } from 'lcyt-platforms';
import { createStatsRouter } from './stats.js';
import { createUsageRouter } from './usage.js';
import { createViewerRouter } from './viewer.js';
import { createVideoRouter } from './video.js';
import { createSttRouter } from './stt.js';
import { createTargetsRouter } from './targets.js';
import { createBroadcastsRouter } from './broadcasts.js';
import { createVideosRouter } from './videos.js';
import { createTranslationRouter } from './translation.js';
import { createBridgeDownloadRouter } from './bridge-download.js';
import { createFilesRouter } from 'lcyt-files';
import { requireProjectRole } from '../middleware/project-access.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {{ hlsManager?: object, hlsSubsManager?: object, sttManager?: object, resolveStorage?: Function, invalidateStorageCache?: Function, settings?: import('../settings/service.js').SettingsService, platforms?: object }} [managers]
 * @param {import('express').RequestHandler} [projectAuth]
 * @returns {Router}
 */
export function createContentRouters(db, auth, store, jwtSecret, { hlsManager = null, hlsSubsManager = null, sttManager = null, resolveStorage = null, invalidateStorageCache = null, settings = null, platforms = null } = {}, makeScopedAuth = null) {
  const router = Router();
  // Per-resource project access for scoped external tokens; falls back to the
  // session-JWT `auth` when no factory is supplied (isolated tests).
  const scoped = (resource) => (makeScopedAuth ? makeScopedAuth(resource) : auth);
  router.use('/stats',           createStatsRouter(db, auth, store, { resolveStorage, settings }));
  router.use('/usage',           createUsageRouter(db, settings));
  // storage-config is Setup-tier (plan_project_roles.md) — GET stays open to
  // any project member via requireProjectRole's own read exemption; every
  // other /file route (list/create/update/delete) keeps working unchanged
  // under the same scoped auth, reading apiKey off req.session directly
  // instead of resolving a live /live session (see CONSIDER.md).
  router.use('/file',            createFilesRouter(db, scoped('file'), store, jwtSecret, resolveStorage, invalidateStorageCache, requireProjectRole(db, 'setup')));
  router.use('/viewer',          createViewerRouter(db));
  router.use('/video',           createVideoRouter(db, hlsManager, hlsSubsManager));
  router.use('/stt',             createSttRouter(scoped('stt'), sttManager, db, jwtSecret, settings));
  router.use('/targets',         createTargetsRouter(scoped('target'), db));
  // Mounted before /broadcasts so the more specific path wins outright rather
  // than relying on the broadcasts router failing to match and calling next().
  if (platforms) {
    router.use('/broadcasts/:id/platforms', createBroadcastPlatformsRouter(db, scoped('broadcast'), platforms));
  }
  router.use('/broadcasts',      createBroadcastsRouter(scoped('broadcast'), db));
  router.use('/videos',          createVideosRouter(scoped('video'), db));
  router.use('/translation',     createTranslationRouter(scoped('translation'), db));
  router.use('/bridge-download', createBridgeDownloadRouter(settings));
  return router;
}
