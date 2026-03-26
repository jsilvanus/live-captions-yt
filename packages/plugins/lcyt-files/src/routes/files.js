/**
 * /file router — list, download, and delete caption files.
 *
 * Uses the injected storage adapter for download and deletion so the same
 * routes work for both local-FS and S3-backed deployments.
 */

import { Router } from 'express';
import { basename } from 'node:path';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { listCaptionFiles, getCaptionFile, deleteCaptionFile } from 'lcyt-backend/db';

// Rate limiter: max 60 requests per minute per IP for file operations
const fileRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/**
 * Factory for the /file router.
 *
 * GET    /file          — List all caption files for the authenticated key
 * GET    /file/:id      — Download a specific file (supports ?token= for direct links)
 * DELETE /file/:id      — Delete a specific file (database row + storage object)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @param {import('../../../lcyt-backend/src/store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {import('../adapters/types.js').StorageAdapter} storage
 * @returns {Router}
 */
export function createFilesRouter(db, auth, store, jwtSecret, storage) {
  const router = Router();

  // GET /file — List files
  router.get('/', fileRateLimit, auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const files = listCaptionFiles(db, session.apiKey).map(row => ({
      id: row.id,
      filename: basename(row.filename),   // strip path/prefix for display
      lang: row.lang,
      format: row.format,
      type: row.type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sizeBytes: row.size_bytes,
    }));
    return res.json({ files });
  });

  // GET /file/:id — Download a file (supports Bearer or ?token=)
  router.get('/:id', fileRateLimit, async (req, res) => {
    // Accept token via Authorization header or ?token= query param (for direct download links)
    let apiKey = null;
    const authHeader = req.headers['authorization'];
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.token || null);
    if (!rawToken) return res.status(401).json({ error: 'Authorization required' });
    try {
      const payload = jwt.verify(rawToken, jwtSecret);
      const session = store.get(payload.sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      apiKey = session.apiKey;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file id' });

    const row = getCaptionFile(db, id, apiKey);
    if (!row) return res.status(404).json({ error: 'File not found' });

    try {
      const { stream, contentType, size } = await storage.openRead(apiKey, row.filename, row.format);
      res.set('Content-Type', contentType + '; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${basename(row.filename)}"`);
      if (size != null) res.set('Content-Length', String(size));
      stream.pipe(res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(404).json({ error: 'File not found in storage' });
      }
    }
  });

  // DELETE /file/:id — Delete a file
  router.delete('/:id', fileRateLimit, auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file id' });

    const row = getCaptionFile(db, id, session.apiKey);
    if (!row) return res.status(404).json({ error: 'File not found' });

    // Delete database row first (authoritative; best-effort storage deletion follows)
    const deleted = deleteCaptionFile(db, id, session.apiKey);
    if (!deleted) return res.status(404).json({ error: 'File not found' });

    // Best-effort deletion from storage backend
    await storage.deleteFile(session.apiKey, row.filename).catch(err => {
      console.warn('[file] Could not delete from storage:', err.message);
    });

    return res.json({ ok: true });
  });

  return router;
}
