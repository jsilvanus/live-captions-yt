/**
 * /targets routes — server-persisted caption delivery targets
 * (plan/selfservice_config_backend §1).
 *
 * Session Bearer auth, same as /stt/config — these are per-connected-project
 * settings, not user-account-level settings.
 *
 * Routes:
 *   GET    /targets          — list all caption targets for the API key
 *   POST   /targets          — create a target
 *   PUT    /targets/:id      — update a target
 *   DELETE /targets/:id      — delete a target
 *   PUT    /targets/reorder  — persist a new sort order in one call
 */

import { Router } from 'express';
import {
  getCaptionTargets, createCaptionTarget, updateCaptionTarget,
  deleteCaptionTarget, reorderCaptionTargets,
} from '../db/caption-targets.js';

/**
 * @param {import('express').RequestHandler} auth  Session JWT Bearer middleware
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createTargetsRouter(auth, db) {
  const router = Router();

  router.get('/', auth, (req, res) => {
    const targets = getCaptionTargets(db, req.session.apiKey);
    res.json({ targets });
  });

  router.post('/', auth, (req, res) => {
    const { id, type, enabled, streamKey, url, headers, viewerKey, noBatch } = req.body || {};
    const result = createCaptionTarget(db, req.session.apiKey, { id, type, enabled, streamKey, url, headers, viewerKey, noBatch });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, target: result.target });
  });

  // PUT /targets/reorder — registered before /:id so "reorder" isn't treated as an id
  router.put('/reorder', auth, (req, res) => {
    const { order } = req.body || {};
    const result = reorderCaptionTargets(db, req.session.apiKey, order);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  router.put('/:id', auth, (req, res) => {
    const { enabled, streamKey, url, headers, viewerKey, noBatch } = req.body || {};
    const result = updateCaptionTarget(db, req.session.apiKey, req.params.id, { enabled, streamKey, url, headers, viewerKey, noBatch });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, target: result.target });
  });

  router.delete('/:id', auth, (req, res) => {
    const deleted = deleteCaptionTarget(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Target not found' });
    res.json({ ok: true });
  });

  return router;
}
