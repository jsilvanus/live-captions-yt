/**
 * Session router group — caption delivery core.
 *
 * Mounts: /live, /captions, /events, /sync, /mic
 *
 * All routes depend on the in-memory SessionStore.
 */
import { Router } from 'express';
import { createLiveRouter } from './live.js';
import { createCaptionsRouter } from './captions.js';
import { createEventsRouter } from './events.js';
import { createSyncRouter } from './sync.js';
import { createMicRouter } from './mic.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {import('express').RequestHandler} auth
 * @param {{ relayManager?: object, dskCaptionProcessor?: Function, resolveStorage?: Function }} [opts]
 * @returns {Router}
 */
export function createSessionRouters(db, store, jwtSecret, auth, { relayManager = null, dskCaptionProcessor = null, resolveStorage = null } = {}) {
  const router = Router();
  router.use('/live',     createLiveRouter(db, store, jwtSecret));
  router.use('/captions', createCaptionsRouter(store, auth, db, relayManager, dskCaptionProcessor, resolveStorage));
  router.use('/events',   createEventsRouter(store, jwtSecret));
  router.use('/sync',     createSyncRouter(store, auth));
  router.use('/mic',      createMicRouter(store, auth));
  return router;
}
