/**
 * Session router group — caption delivery core.
 *
 * Mounts: /live, /captions, /events, /sync, /mic, /features
 *
 * All routes depend on the in-memory SessionStore.
 */
import { Router } from 'express';
import { createLiveRouter } from './live.js';
import { createCaptionsRouter } from './captions.js';
import { createEventsRouter } from './events.js';
import { createSyncRouter } from './sync.js';
import { createMicRouter } from './mic.js';
import { getProjectFeatures } from '../db/project-features.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {import('express').RequestHandler} auth
 * @param {{ relayManager?: object, dskCaptionProcessor?: Function, soundCaptionProcessor?: Function, cueProcessor?: Function, resolveStorage?: Function }} [opts]
 * @returns {Router}
 */
export function createSessionRouters(db, store, jwtSecret, auth, { relayManager = null, dskCaptionProcessor = null, soundCaptionProcessor = null, cueProcessor = null, resolveStorage = null } = {}) {
  const router = Router();
  router.use('/live',     createLiveRouter(db, store, jwtSecret));
  router.use('/captions', createCaptionsRouter(store, auth, db, relayManager, dskCaptionProcessor, resolveStorage, soundCaptionProcessor, cueProcessor));
  router.use('/events',   createEventsRouter(store, jwtSecret));
  router.use('/sync',     createSyncRouter(store, auth));
  router.use('/mic',      createMicRouter(store, auth));

  // GET /features — return enabled feature codes for the authenticated session key
  router.get('/features', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });
    const rows = getProjectFeatures(db, apiKey);
    const features = rows.filter(r => r.enabled).map(r => r.feature_code);
    return res.json({ features });
  });

  return router;
}
