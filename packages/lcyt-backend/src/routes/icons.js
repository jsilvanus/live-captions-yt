/**
 * /icons — upload, list, serve, and delete user icons (PNG/SVG).
 *
 * Icons are used to brand viewer pages: the streamer uploads a PNG or SVG
 * logo in Settings → Icons, then chooses it in CC → Targets → Viewer.
 * The viewer page fetches the icon via the public GET /icons/:id endpoint.
 *
 * Routes:
 *   POST   /icons       — upload a PNG or SVG (auth required; JSON body with base64 data)
 *   GET    /icons       — list icons for the authenticated key (auth required)
 *   GET    /icons/:id   — serve icon file (public, CORS *, no auth)
 *   DELETE /icons/:id   — delete icon (auth required)
 *
 * The POST route uses its own body parser (express.json limit: 400kb) so it
 * must be mounted BEFORE the global 64kb JSON body parser.
 */

import { Router } from 'express';
import express from 'express';
import {
  createReadStream, existsSync, unlinkSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { registerIcon, listIcons, getIcon, deleteIcon } from '../db.js';

const ICONS_DIR = resolve(process.env.ICONS_DIR || '/data/icons');

/** Maximum icon file size in bytes (200 KB). Base64-encoded that's ~267 KB body. */
const MAX_ICON_BYTES = 200 * 1024;

/** Only PNG and SVG icons are accepted. */
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/svg+xml']);

const iconRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/**
 * Factory for the /icons router.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../middleware/auth.js').AuthMiddleware} auth
 * @param {import('../store.js').SessionStore} store
 * @param {string} [baseDir] - Override the icons base directory (for tests).
 * @returns {Router}
 */
export function createIconRouter(db, auth, store, baseDir) {
  const ICONS_DIR = resolve(baseDir || process.env.ICONS_DIR || '/data/icons');
  const router = Router();

  // ── POST /icons — upload a PNG or SVG icon ─────────────────────────────────
  //
  // Body (application/json, up to 400kb):
  //   { filename: string, mimeType: 'image/png'|'image/svg+xml', data: string (base64) }
  //
  // The route uses its own body parser so it can accept larger payloads than
  // the global 64kb express.json limit without changing the global limit.
  router.post(
    '/',
    iconRateLimit,
    express.json({ limit: '400kb' }),
    auth,
    (req, res) => {
      const { sessionId } = req.session;
      const session = store.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const { filename, mimeType, data } = req.body ?? {};

      if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'filename is required' });
      }
      if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
        return res.status(400).json({ error: 'mimeType must be image/png or image/svg+xml' });
      }
      if (!data || typeof data !== 'string') {
        return res.status(400).json({ error: 'data (base64) is required' });
      }

      let buf;
      try {
        buf = Buffer.from(data, 'base64');
      } catch {
        return res.status(400).json({ error: 'data must be valid base64' });
      }

      if (buf.length > MAX_ICON_BYTES) {
        return res.status(413).json({
          error: `Icon exceeds maximum size of ${MAX_ICON_BYTES} bytes`,
        });
      }

      // Validate PNG magic bytes or SVG content
      if (mimeType === 'image/png') {
        // PNG magic: 89 50 4E 47 0D 0A 1A 0A
        if (
          buf.length < 8 ||
          buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47
        ) {
          return res.status(400).json({ error: 'Uploaded file does not appear to be a valid PNG' });
        }
      } else if (mimeType === 'image/svg+xml') {
        const text = buf.toString('utf8', 0, Math.min(buf.length, 512));
        if (!text.includes('<svg') && !text.includes('<?xml')) {
          return res.status(400).json({ error: 'Uploaded file does not appear to be a valid SVG' });
        }
      }

      const ext = mimeType === 'image/svg+xml' ? '.svg' : '.png';
      const safeKey = session.apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
      const diskFilename = `${randomUUID()}${ext}`;
      const dir = join(ICONS_DIR, safeKey);

      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, diskFilename), buf);
      } catch (err) {
        console.error('[icons] Failed to write file:', err.message);
        return res.status(500).json({ error: 'Failed to save icon' });
      }

      const id = registerIcon(db, {
        apiKey: session.apiKey,
        filename: basename(filename).slice(0, 255),
        diskFilename,
        mimeType,
        sizeBytes: buf.length,
      });

      return res.status(201).json({
        ok: true,
        id,
        filename: basename(filename),
        mimeType,
        sizeBytes: buf.length,
      });
    }
  );

  // ── GET /icons — list icons for the authenticated key ──────────────────────
  router.get('/', iconRateLimit, auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const icons = listIcons(db, session.apiKey).map(row => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      createdAt: row.created_at,
      sizeBytes: row.size_bytes,
    }));
    return res.json({ icons });
  });

  // ── GET /icons/:id — serve icon (public, no auth, CORS *) ─────────────────
  router.get('/:id', iconRateLimit, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Invalid icon id' });

    const row = getIcon(db, id);
    if (!row) return res.status(404).json({ error: 'Icon not found' });

    const safeKey = row.api_key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    const filepath = join(ICONS_DIR, safeKey, row.disk_filename);
    if (!existsSync(filepath)) return res.status(404).json({ error: 'Icon file not found on disk' });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', row.size_bytes);
    createReadStream(filepath).pipe(res);
  });

  // ── DELETE /icons/:id — delete icon (auth required) ────────────────────────
  router.delete('/:id', iconRateLimit, auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Invalid icon id' });

    const row = getIcon(db, id);
    if (!row || row.api_key !== session.apiKey) {
      return res.status(404).json({ error: 'Icon not found' });
    }

    const deleted = deleteIcon(db, id, session.apiKey);
    if (!deleted) return res.status(404).json({ error: 'Icon not found' });

    // Best-effort disk cleanup
    try {
      const safeKey = row.api_key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
      const filepath = join(ICONS_DIR, safeKey, row.disk_filename);
      if (existsSync(filepath)) unlinkSync(filepath);
    } catch (e) {
      console.warn('[icons] Could not delete disk file:', e.message);
    }

    return res.json({ ok: true });
  });

  return router;
}
