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
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

async function writeFileContent(storage, apiKey, storageKey, buffer, contentType) {
  if (storage?.putObject) {
    await storage.putObject(apiKey, storageKey, buffer, contentType);
    return;
  }
  if (storage?.openAppend) {
    const handle = storage.openAppend(apiKey, storageKey);
    await handle.write(buffer);
    await handle.close();
    return;
  }
  throw new Error('Storage adapter does not support object writes');
}
import {
  listCaptionFiles,
  getCaptionFile,
  deleteCaptionFile,
  hasFeature,
  registerCaptionFile,
  updateCaptionFileSize,
} from 'lcyt-backend/db';
import { runFilesDbMigrations, getKeyStorageConfig, setKeyStorageConfig, deleteKeyStorageConfig } from '../db.js';
import { shiftVttContent } from '../vtt.js';
import logger from 'lcyt/logger';

// Sanity bound for ?offsetMs= on VTT downloads: ±24h
const MAX_OFFSET_MS = 86_400_000;

function contentTypeForFormat(format) {
  if (format === 'vtt') return 'text/vtt';
  if (format === 'md' || format === 'markdown' || format === 'mdx') return 'text/markdown';
  return 'text/plain';
}

function displayNameForStoredKey(storedKey) {
  const raw = String(storedKey || '').trim();
  if (!raw) return '';
  const base = raw.split(/[\\/]/).pop() || raw;
  return base.replace(/^\d{10,}-[0-9a-f-]{36}-/i, '').replace(/\.(md|txt|vtt)$/i, '');
}

function makeStorageKey(filename, fallbackType) {
  const raw = String(filename || '').trim();
  const base = raw ? raw.replace(/[^a-zA-Z0-9._-]+/g, '_') : `${fallbackType || 'file'}`;
  return `${Date.now()}-${randomUUID()}-${base}`;
}

function storageKeyTypeFor(type) {
  return type === 'rundown' ? 'rundown' : 'file';
}

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
    res.set('Cache-Control', 'private, max-age=300');
    if (!config) {
      return res.json({ storageMode: 'default', config: null });
    }

    const isWebDav = config.storage_type === 'webdav';
    // Return config with secret key masked
    return res.json({
      storageMode: isWebDav ? 'custom-webdav' : 'custom-s3',
      config: {
        storage_type:      config.storage_type || 's3',
        bucket:            config.bucket       || null,
        region:            config.region,
        endpoint:          config.endpoint     || null,
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

    const { storage_type, bucket, region, endpoint, prefix, access_key_id, secret_access_key } = req.body || {};
    const storageType = (storage_type === 'webdav') ? 'webdav' : 's3';

    if (storageType === 'webdav') {
      // Require "files-webdav" project feature
      if (!hasFeature(db, session.apiKey, 'files-webdav')) {
        return res.status(403).json({ error: 'WebDAV storage is not enabled for this key' });
      }
      if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
        return res.status(400).json({ error: 'endpoint (WebDAV server URL) is required' });
      }
    } else {
      // Require "files-custom-bucket" project feature
      if (!hasFeature(db, session.apiKey, 'files-custom-bucket')) {
        return res.status(403).json({ error: 'Custom storage bucket is not enabled for this key' });
      }
      if (!bucket || typeof bucket !== 'string' || !bucket.trim()) {
        return res.status(400).json({ error: 'bucket is required' });
      }
    }

    setKeyStorageConfig(db, session.apiKey, {
      storage_type:      storageType,
      bucket:            bucket ? bucket.trim() : '',
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

    const typeFilter = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const files = listCaptionFiles(db, session.apiKey)
      .filter(row => !typeFilter || row.type === typeFilter)
      .map(row => ({
        id: row.id,
        filename: basename(row.filename),   // strip path/prefix for display
        displayName: displayNameForStoredKey(row.filename),
        lang: row.lang,
        format: row.format,
        type: row.type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sizeBytes: row.size_bytes,
      }));
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res.json({ files });
  });

  // POST /file — Create a new caption/rundown file with full content
  router.post('/', fileRateLimit, auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { filename, content, format = 'md', type = 'captions', lang } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }

    const requestedName = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : (type === 'rundown' ? 'rundown.md' : 'captions.txt');
    const storageKey = makeStorageKey(requestedName, storageKeyTypeFor(type));
    const buffer = Buffer.from(content, 'utf8');
    const storage = await _resolve(session.apiKey).catch(() => null);
    const contentType = contentTypeForFormat(format);

    try {
      await writeFileContent(storage, session.apiKey, storageKey, buffer, contentType);

      const id = registerCaptionFile(db, {
        apiKey: session.apiKey,
        sessionId: session.sessionId ?? null,
        filename: storageKey,
        lang: lang ?? null,
        format,
        type,
      });
      updateCaptionFileSize(db, id, buffer.byteLength);
      return res.status(201).json({
        ok: true,
        file: {
          id,
          filename: storageKey,
          displayName: displayNameForStoredKey(storageKey),
          type,
          format,
          sizeBytes: buffer.byteLength,
        },
      });
    } catch (err) {
      logger.error('[file] Failed to create caption file:', err.message);
      return res.status(500).json({ error: 'Failed to save file' });
    }
  });

  // PUT /file/:id — Overwrite an existing caption file with full content
  router.put('/:id', fileRateLimit, auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid file id' });

    const row = getCaptionFile(db, id, session.apiKey);
    if (!row) return res.status(404).json({ error: 'File not found' });

    const { filename, content, format = row.format || 'md', type = row.type || 'captions', lang } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }

    const requestedName = typeof filename === 'string' && filename.trim()
      ? filename.trim()
      : displayNameForStoredKey(row.filename) || 'rundown.md';
    const storageKey = makeStorageKey(requestedName, storageKeyTypeFor(type));
    const buffer = Buffer.from(content, 'utf8');
    const storage = await _resolve(session.apiKey).catch(() => null);
    const contentType = contentTypeForFormat(format);

    try {
      await writeFileContent(storage, session.apiKey, storageKey, buffer, contentType);

      if (storage?.deleteFile && row.filename && row.filename !== storageKey) {
        await storage.deleteFile(session.apiKey, row.filename).catch(() => {});
      }

      db.prepare(
        'UPDATE caption_files SET filename = ?, lang = ?, format = ?, type = ?, updated_at = datetime(\'now\') WHERE id = ? AND api_key = ?'
      ).run(storageKey, lang ?? row.lang ?? null, format, type, id, session.apiKey);
      updateCaptionFileSize(db, id, buffer.byteLength);
      return res.json({
        ok: true,
        file: {
          id,
          filename: storageKey,
          displayName: displayNameForStoredKey(storageKey),
          type,
          format,
          sizeBytes: buffer.byteLength,
        },
      });
    } catch (err) {
      logger.error('[file] Failed to overwrite caption file:', err.message);
      return res.status(500).json({ error: 'Failed to update file' });
    }
  });

  // GET /file/:id — Download a file (****** or ?token= query param)
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

    // Optional cue-time shift for VTT files (?offsetMs=±N) — lets the user
    // align archived captions to a VOD timeline without modifying the file.
    let offsetMs = 0;
    if (req.query.offsetMs !== undefined) {
      offsetMs = Number(req.query.offsetMs);
      if (!Number.isFinite(offsetMs) || !Number.isInteger(offsetMs) || Math.abs(offsetMs) > MAX_OFFSET_MS) {
        return res.status(400).json({ error: `offsetMs must be an integer between -${MAX_OFFSET_MS} and ${MAX_OFFSET_MS}` });
      }
      if (offsetMs !== 0 && row.format !== 'vtt') {
        return res.status(400).json({ error: 'offsetMs is only supported for vtt files' });
      }
    }

    try {
      const storage = await _resolve(apiKey);
      const { stream, contentType, size } = await storage.openRead(apiKey, row.filename, row.format);
      res.set('Cache-Control', 'private, max-age=31536000, immutable');
      res.set('Content-Type', contentType + '; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${basename(row.filename)}"`);

      if (offsetMs !== 0) {
        // Buffer + transform: caption files are small (KBs–low MBs) and the
        // shifted length differs from the stored size, so streaming is out.
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const shifted = shiftVttContent(Buffer.concat(chunks).toString('utf8'), offsetMs);
        res.set('Content-Length', String(Buffer.byteLength(shifted)));
        return res.send(shifted);
      }

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
      logger.warn('[file] Could not delete from storage:', err.message);
    });

    return res.json({ ok: true });
  });

  return router;
}
