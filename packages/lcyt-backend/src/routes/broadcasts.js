/**
 * /broadcasts routes — first-class intra-project broadcast entity (plan/broadcasts).
 *
 * Session/project Bearer auth (per-connected-project), same as /targets.
 *
 * Routes:
 *   GET    /broadcasts                    — list (?status=, ?from=, ?to=, ?includeArchived=1)
 *   POST   /broadcasts                    — create (draft)
 *   GET    /broadcasts/:id                — one broadcast + linked assets
 *   PUT    /broadcasts/:id                — edit title/desc/schedule/status
 *   DELETE /broadcasts/:id                — archive, or hard-delete if already archived past cooling-off
 *   POST   /broadcasts/:id/restore        — un-archive
 *   POST   /broadcasts/:id/duplicate      — clone (config + asset links, no produced content)
 *   POST   /broadcasts/:id/assets         — link a reusable asset
 *   DELETE /broadcasts/:id/assets/:rowId  — unlink
 */

import { Router } from 'express';
import {
  listBroadcasts, getBroadcast, createBroadcast, updateBroadcast,
  restoreBroadcast, deleteBroadcast,
  duplicateBroadcast, linkAsset, unlinkAsset,
} from '../db/broadcasts.js';

/**
 * @param {import('express').RequestHandler} auth  project-access / session Bearer middleware
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createBroadcastsRouter(auth, db) {
  const router = Router();

  router.get('/', auth, (req, res) => {
    const { status, from, to, includeArchived } = req.query || {};
    const broadcasts = listBroadcasts(db, req.session.apiKey, {
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      includeArchived: includeArchived === '1' || includeArchived === 'true',
    });
    res.json({ broadcasts });
  });

  router.post('/', auth, (req, res) => {
    const { title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId } = req.body || {};
    const result = createBroadcast(db, req.session.apiKey, {
      title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId,
    });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, broadcast: result.broadcast });
  });

  router.get('/:id', auth, (req, res) => {
    const broadcast = getBroadcast(db, req.session.apiKey, req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ broadcast });
  });

  router.put('/:id', auth, (req, res) => {
    const { title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId } = req.body || {};
    const result = updateBroadcast(db, req.session.apiKey, req.params.id, {
      title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId,
    });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, broadcast: result.broadcast });
  });

  // DELETE — first call archives; a second call on an archived broadcast
  // permanently deletes it, but only once past the cooling-off window.
  router.delete('/:id', auth, (req, res) => {
    const result = deleteBroadcast(db, req.session.apiKey, req.params.id);
    if (result.ok) return res.json({ ok: true });
    // 202: archived on this call, not yet permanently deleted.
    if (result.status === 202) return res.status(202).json({ ok: true, archived: true, broadcast: result.archive });
    return res.status(result.status || 400).json({ error: result.error });
  });

  router.post('/:id/restore', auth, (req, res) => {
    const result = restoreBroadcast(db, req.session.apiKey, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, broadcast: result.broadcast });
  });

  router.post('/:id/duplicate', auth, (req, res) => {
    const { targetApiKey } = req.body || {};
    if (targetApiKey && targetApiKey !== req.session.apiKey) {
      // Cross-project deep-copy is a follow-up (per-asset-type copy routines).
      return res.status(501).json({ error: 'Cross-project duplicate not yet implemented' });
    }
    const result = duplicateBroadcast(db, req.session.apiKey, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, broadcast: result.broadcast });
  });

  router.post('/:id/assets', auth, (req, res) => {
    const { assetType, assetRef, sortOrder } = req.body || {};
    const result = linkAsset(db, req.session.apiKey, req.params.id, { assetType, assetRef, sortOrder });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, asset: result.asset });
  });

  router.delete('/:id/assets/:rowId', auth, (req, res) => {
    const result = unlinkAsset(db, req.session.apiKey, req.params.id, req.params.rowId);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true });
  });

  return router;
}
