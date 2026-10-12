/**
 * /broadcasts routes — first-class intra-project broadcast entity (plan/broadcasts).
 *
 * Session/project Bearer auth (per-connected-project), same as /targets.
 *
 * Routes:
 *   GET    /broadcasts                    — list (?status=, ?from=, ?to=, ?includeArchived=1)
 *   POST   /broadcasts                    — create (draft)
 *   GET    /broadcasts/active             — current active broadcast pointer
 *   DELETE /broadcasts/active             — clear active broadcast pointer
 *   GET    /broadcasts/:id                — one broadcast + linked assets
 *   PUT    /broadcasts/:id                — edit title/desc/schedule/status
 *   DELETE /broadcasts/:id                — archive, or hard-delete if already archived past cooling-off
 *   POST   /broadcasts/:id/restore        — un-archive
 *   POST   /broadcasts/:id/duplicate      — clone (config + asset links, no produced content)
 *   GET    /broadcasts/:id/files          — list files linked to this broadcast
 *   POST   /broadcasts/:id/files          — link a file to this broadcast
 *   DELETE /broadcasts/:id/files/:fileId  — unlink a file from this broadcast
 *   POST   /broadcasts/:id/assets         — link a reusable asset
 *   DELETE /broadcasts/:id/assets/:rowId  — unlink
 */

import { Router } from 'express';
import {
  listBroadcasts, getBroadcast, createBroadcast, updateBroadcast,
  restoreBroadcast, deleteBroadcast,
  duplicateBroadcast, getActiveBroadcast, activateBroadcast, deactivateBroadcast,
  listBroadcastFiles, linkBroadcastFile, unlinkBroadcastFile,
  linkAsset, unlinkAsset,
} from '../db/broadcasts.js';
import { getProjectName } from '../db/keys.js';

/**
 * @param {import('express').RequestHandler} auth  project-access / session Bearer middleware
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createBroadcastsRouter(auth, db) {
  const router = Router();

  router.get('/', auth, async (req, res) => {
    const { status, from, to, includeArchived } = req.query || {};
    const broadcasts = await listBroadcasts(db, req.session.apiKey, {
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      includeArchived: includeArchived === '1' || includeArchived === 'true',
    });
    res.json({ broadcasts });
  });

  router.post('/', auth, async (req, res) => {
    const { title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId, recordEnabled, privacyStatus } = req.body || {};
    const result = await createBroadcast(db, req.session.apiKey, {
      title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId, recordEnabled, privacyStatus,
    });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, broadcast: result.broadcast });
  });

  router.get('/active', auth, async (req, res) => {
    const broadcast = await getActiveBroadcast(db, req.session.apiKey);
    res.json({
      activeBroadcastId: broadcast?.id ?? null,
      broadcast,
      projectName: await getProjectName(db, req.session.apiKey),
    });
  });

  router.delete('/active', auth, async (req, res) => {
    await deactivateBroadcast(db, req.session.apiKey);
    res.json({ ok: true, activeBroadcastId: null });
  });

  router.post('/:id/activate', auth, async (req, res) => {
    const result = await activateBroadcast(db, req.session.apiKey, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, activeBroadcastId: result.broadcast.id, broadcast: result.broadcast });
  });

  router.get('/:id', auth, async (req, res) => {
    const broadcast = await getBroadcast(db, req.session.apiKey, req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ broadcast });
  });

  router.put('/:id', auth, async (req, res) => {
    const { title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId, recordEnabled, privacyStatus } = req.body || {};
    const result = await updateBroadcast(db, req.session.apiKey, req.params.id, {
      title, description, status, scheduledStart, scheduledEnd, youtubeBroadcastId, rundownFileId, recordEnabled, privacyStatus,
    });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, broadcast: result.broadcast });
  });

  // DELETE — first call archives; a second call on an archived broadcast
  // permanently deletes it, but only once past the cooling-off window.
  router.delete('/:id', auth, async (req, res) => {
    const result = await deleteBroadcast(db, req.session.apiKey, req.params.id);
    if (result.ok) return res.json({ ok: true });
    // 202: archived on this call, not yet permanently deleted.
    if (result.status === 202) return res.status(202).json({ ok: true, archived: true, broadcast: result.archive });
    return res.status(result.status || 400).json({ error: result.error });
  });

  router.post('/:id/restore', auth, async (req, res) => {
    const result = await restoreBroadcast(db, req.session.apiKey, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, broadcast: result.broadcast });
  });

  router.post('/:id/duplicate', auth, async (req, res) => {
    const { targetApiKey } = req.body || {};
    if (targetApiKey && targetApiKey !== req.session.apiKey) {
      // Cross-project deep-copy is a follow-up (per-asset-type copy routines).
      return res.status(501).json({ error: 'Cross-project duplicate not yet implemented' });
    }
    const result = await duplicateBroadcast(db, req.session.apiKey, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, broadcast: result.broadcast });
  });

  router.get('/:id/files', auth, async (req, res) => {
    const files = await listBroadcastFiles(db, req.session.apiKey, req.params.id);
    if (files === null) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ files });
  });

  router.post('/:id/files', auth, async (req, res) => {
    const { fileId } = req.body || {};
    const result = await linkBroadcastFile(db, req.session.apiKey, req.params.id, fileId);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, file: result.file });
  });

  router.delete('/:id/files/:fileId', auth, async (req, res) => {
    const result = await unlinkBroadcastFile(db, req.session.apiKey, req.params.id, req.params.fileId);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true });
  });

  router.post('/:id/assets', auth, async (req, res) => {
    const { assetType, assetRef, sortOrder } = req.body || {};
    const result = await linkAsset(db, req.session.apiKey, req.params.id, { assetType, assetRef, sortOrder });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, asset: result.asset });
  });
 
  router.delete('/:id/assets/:rowId', auth, async (req, res) => {
    const result = await unlinkAsset(db, req.session.apiKey, req.params.id, req.params.rowId);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true });
  });

  return router;
}
