/**
 * /file router — list, download, delete caption files + per-key S3 config.
 *
 * Uses the injected resolveStorage function so the correct storage adapter
 * (global or per-key) is chosen for every download and deletion.
 *
 * Storage config endpoints:
 *   GET    /file/storage-config        — get current per-key S3 config (credentials masked)
 *   PUT    /file/storage-config        — set per-key S3 config (requires "custom-storage" feature)
 *   DELETE /file/storage-config        — remove per-key S3 config (revert to global default)
 */

import { Router } from 'express';
import { basename } from 'node:path';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import {
  listCaptionFiles,
  getCaptionFile,
  deleteCaptionFile,
  hasFeature,
} from 'lcyt-backend/db';
import { runFilesDbMigrations, getKeyStorageConfig, setKeyStorageConfig, deleteKeyStorageConfig } from '../db.js';

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
 * GET    /file                   — List all caption files for the authenticated key
 * GET    /file/:id               — Download a specific file (supports ?token= for direct links)
 * DELETE /file/:id               — Delete a specific file (database row + storage object)
 * GET    /file/storage-config    — Get per-key S3 config (credentials masked)
 * PUT    /file/storage-config    — Set per-key S3 config (requires "custom-storage" feature)
 * DELETE /file/storage-config    — Remove per-key S3 config (revert to global default)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @param {import('../../../lcyt-backend/src/store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {(apiKey: string) => Promise<import('../adapters/types.js').StorageAdapter>} resolveStorage
 * @param {(apiKey: string) => void} [invalidateStorageCache]
 * @returns {Router}
 */
export function createFilesRouter(db, auth, store, jwtSecret, resolveStorage, invalidateStorageCache = () => {}) {
  // Ensure the key_storage_config table exists (idempotent — safe to call on every startup)
  if (db) runFilesDbMigrations(db);

  // Defensive fallback: if no resolver provided, use an adapter-less stub that returns 503
  const _resolve = resolveStorage ?? (() => Promise.reject(new Error('Storage not configured')));

  const router = Router();

  // ── Storage config endpoints (must be registered before /:id to avoid route conflicts) ──

  // GET /file/storage-config — return current config (credentials masked)
  router.get('/storage-config', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const config = getKeyStorageConfig(db, session.apiKey);
    if (!config) {
      return res.json({ storageMode: 'default', config: null });
    }

    // Return config with secret key masked
    return res.json({
      storageMode: 'custom-s3',
      config: {
        bucket:            config.bucket,
        region:            config.region,
        endpoint:          config.endpoint || null,
        prefix:            config.prefix,
        access_key_id:     config.access_key_id || null,
        secret_access_key: config.secret_access_key ? '••••••••' : null,
        updated_at:        config.updated_at,
      },
    });
  });

  // PUT /file/storage-config — set per-key S3 config
  router.put('/storage-config', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Require "files-custom-bucket" project feature
    if (!hasFeature(db, session.apiKey, 'files-custom-bucket')) {
      return res.status(403).json({ error: 'Custom storage bucket is not enabled for this key' });
    }

    const { bucket, region, endpoint, prefix, access_key_id, secret_access_key } = req.body || {};
    if (!bucket || typeof bucket !== 'string' || !bucket.trim()) {
      return res.status(400).json({ error: 'bucket is required' });
    }

    setKeyStorageConfig(db, session.apiKey, {
      bucket: bucket.trim(),
      region:            region            || 'auto',
      endpoint:          endpoint          || null,
      prefix:            prefix            || 'captions',
      access_key_id:     access_key_id     || null,
      secret_access_key: secret_access_key || null,
    });

    // Invalidate cached adapter so the next request uses the new config
    invalidateStorageCache(session.apiKey);

    return res.json({ ok: true });
  });

  // DELETE /file/storage-config — remove per-key config (revert to global default)
  router.delete('/storage-config', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    deleteKeyStorageConfig(db, session.apiKey);
    invalidateStorageCache(session.apiKey);

    return res.json({ ok: true });
  });

  // ── Caption file endpoints ──────────────────────────────────────────────────

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
      const storage = await _resolve(apiKey);
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

    // Best-effort deletion from storage backend (uses per-key adapter if configured)
    const storage = await _resolve(session.apiKey).catch(() => null);
    await storage?.deleteFile(session.apiKey, row.filename).catch(err => {
      console.warn('[file] Could not delete from storage:', err.message);
    });

    return res.json({ ok: true });
  });

  return router;
}
