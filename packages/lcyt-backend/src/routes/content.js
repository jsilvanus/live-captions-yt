/**
 * Content router group — analytics, files, media, and auxiliary endpoints.
 *
 * Mounts: /stats, /usage, /file, /viewer, /video, /youtube, /stt, /targets,
 *         /translation, /bridge-download
 */
import { Router } from 'express';
import { createStatsRouter } from './stats.js';
import { createUsageRouter } from './usage.js';
import { createViewerRouter } from './viewer.js';
import { createVideoRouter } from './video.js';
import { createYouTubeRouter } from './youtube.js';
import { createSttRouter } from './stt.js';
import { createTargetsRouter } from './targets.js';
import { createBroadcastsRouter } from './broadcasts.js';
import { createVideosRouter } from './videos.js';
import { createTranslationRouter } from './translation.js';
import { createBridgeDownloadRouter } from './bridge-download.js';
import { createFilesRouter } from 'lcyt-files';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {{ hlsManager?: object, hlsSubsManager?: object, sttManager?: object, resolveStorage?: Function, invalidateStorageCache?: Function, settings?: import('../settings/service.js').SettingsService }} [managers]
 * @param {import('express').RequestHandler} [projectAuth]
 * @returns {Router}
 */
export function createContentRouters(db, auth, store, jwtSecret, { hlsManager = null, hlsSubsManager = null, sttManager = null, resolveStorage = null, invalidateStorageCache = null, settings = null } = {}, makeScopedAuth = null) {
  const router = Router();
  // Per-resource project access for scoped external tokens; falls back to the
  // session-JWT `auth` when no factory is supplied (isolated tests).
  const scoped = (resource) => (makeScopedAuth ? makeScopedAuth(resource) : auth);
  router.use('/stats',           createStatsRouter(db, auth, store, { resolveStorage, settings }));
  router.use('/usage',           createUsageRouter(db, settings));
  router.use('/file',            createFilesRouter(db, auth, store, jwtSecret, resolveStorage, invalidateStorageCache));
  router.use('/viewer',          createViewerRouter(db));
  router.use('/video',           createVideoRouter(db, hlsManager, hlsSubsManager));
  router.use('/youtube',         createYouTubeRouter(auth, settings));
  router.use('/stt',             createSttRouter(scoped('stt'), sttManager, db, jwtSecret));
  router.use('/targets',         createTargetsRouter(scoped('target'), db));
  router.use('/broadcasts',      createBroadcastsRouter(scoped('broadcast'), db));
  router.use('/videos',          createVideosRouter(scoped('video'), db));
  router.use('/translation',     createTranslationRouter(scoped('translation'), db));
  router.use('/bridge-download', createBridgeDownloadRouter(settings));
  return router;
}
