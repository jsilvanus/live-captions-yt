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
import { createTranslationRouter } from './translation.js';
import { createBridgeDownloadRouter } from './bridge-download.js';
import { createFilesRouter } from 'lcyt-files';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {{ hlsManager?: object, hlsSubsManager?: object, sttManager?: object, resolveStorage?: Function, invalidateStorageCache?: Function }} [managers]
 * @param {import('express').RequestHandler} [projectAuth]
 * @returns {Router}
 */
export function createContentRouters(db, auth, store, jwtSecret, { hlsManager = null, hlsSubsManager = null, sttManager = null, resolveStorage = null, invalidateStorageCache = null } = {}, projectAuth = null) {
  const router = Router();
  const scopedAuth = projectAuth || auth;
  router.use('/stats',           createStatsRouter(db, auth, store, { resolveStorage }));
  router.use('/usage',           createUsageRouter(db));
  router.use('/file',            createFilesRouter(db, auth, store, jwtSecret, resolveStorage, invalidateStorageCache));
  router.use('/viewer',          createViewerRouter(db));
  router.use('/video',           createVideoRouter(db, hlsManager, hlsSubsManager));
  router.use('/youtube',         createYouTubeRouter(auth));
  router.use('/stt',             createSttRouter(scopedAuth, sttManager, db, jwtSecret));
  router.use('/targets',         createTargetsRouter(scopedAuth, db));
  router.use('/translation',     createTranslationRouter(scopedAuth, db));
  router.use('/bridge-download', createBridgeDownloadRouter());
  return router;
}
