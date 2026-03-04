import { Router } from 'express';
import { createReadStream, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import jwt from 'jsonwebtoken';
import { listCaptionFiles, getCaptionFile, deleteCaptionFile } from '../db.js';

// Must match the base directory used in captions.js
const FILES_BASE_DIR = resolve(process.env.FILES_DIR || '/data/files');

/**
 * Factory for the /file router.
 *
 * GET    /file          — List all caption files for the authenticated key
 * GET    /file/:id      — Download a specific file (supports ?token= for direct links)
 * DELETE /file/:id      — Delete a specific file (database row + disk file)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @returns {Router}
 */
export function createFileRouter(db, auth, store, jwtSecret) {
  const router = Router();

  // GET /file — List files
  router.get('/', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const files = listCaptionFiles(db, session.apiKey).map(row => ({
      id: row.id,
      filename: row.filename,
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
  router.get('/:id', (req, res) => {
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

    const safe = row.api_key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    const filepath = join(FILES_BASE_DIR, safe, row.filename);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'File not found on disk' });

    const contentType = row.format === 'vtt' ? 'text/vtt' : 'text/plain';
    res.setHeader('Content-Type', contentType + '; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${basename(row.filename)}"`);
    try {
      const { size } = statSync(filepath);
      res.setHeader('Content-Length', size);
    } catch {}

    createReadStream(filepath).pipe(res);
  });

  // DELETE /file/:id — Delete a file
  router.delete('/:id', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file id' });

    const row = getCaptionFile(db, id, session.apiKey);
    if (!row) return res.status(404).json({ error: 'File not found' });

    // Delete database row
    const deleted = deleteCaptionFile(db, id, session.apiKey);
    if (!deleted) return res.status(404).json({ error: 'File not found' });

    // Best-effort disk deletion
    try {
      const safe = row.api_key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
      const filepath = join(FILES_BASE_DIR, safe, row.filename);
      if (existsSync(filepath)) unlinkSync(filepath);
    } catch (e) {
      console.warn('[file] Could not delete disk file:', e.message);
    }

    return res.json({ ok: true });
  });

  return router;
}
