import { Router } from 'express';
import busboy from 'busboy';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  isGraphicsEnabled,
  registerImage,
  listImages,
  getImage,
  getImageByKey,
  deleteImage,
  getTotalImageStorageBytes,
  isShorthandTaken,
} from '../db.js';

const GRAPHICS_BASE_DIR = resolve(process.env.GRAPHICS_DIR || '/data/images');

const ACCEPTED_MIMES = new Set(['image/png', 'image/webp', 'image/svg+xml']);
const MIME_TO_EXT = {
  'image/png':     '.png',
  'image/webp':    '.webp',
  'image/svg+xml': '.svg',
};

const MAX_FILE_BYTES    = Number(process.env.GRAPHICS_MAX_FILE_BYTES)    || 5 * 1024 * 1024;   // 5 MB
const MAX_STORAGE_BYTES = Number(process.env.GRAPHICS_MAX_STORAGE_BYTES) || 50 * 1024 * 1024;  // 50 MB

const SHORTHAND_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;

/**
 * Derive a safe per-key subdirectory name (same convention as caption files).
 * @param {string} apiKey
 * @returns {string} absolute directory path
 */
function ensureImageDir(apiKey) {
  const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  const dir = join(GRAPHICS_BASE_DIR, safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Factory for the /images router.
 *
 * POST   /images       — Upload an image (multipart/form-data; auth required, graphics_enabled key + GRAPHICS_ENABLED env)
 * GET    /images       — List images for the authenticated key (auth required)
 * GET    /images/:id   — Serve image bytes publicly (no auth — for DSK page)
 * DELETE /images/:id   — Delete an image (auth required)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @returns {Router}
 */
export function createImagesRouter(db, auth) {
  const router = Router();

  // POST /images — upload
  router.post('/', auth, (req, res) => {
    if (process.env.GRAPHICS_ENABLED !== '1') {
      return res.status(503).json({ error: 'Graphics upload is not enabled on this server' });
    }

    const apiKey = req.session.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Unauthorized' });

    if (!isGraphicsEnabled(db, apiKey)) {
      return res.status(403).json({ error: 'Graphics upload not enabled for this API key' });
    }

    // Check total storage quota before accepting the upload
    const usedBytes = getTotalImageStorageBytes(db, apiKey);
    if (usedBytes >= MAX_STORAGE_BYTES) {
      return res.status(413).json({
        error: `Storage quota exceeded (${(MAX_STORAGE_BYTES / 1024 / 1024).toFixed(0)} MB limit per key)`,
      });
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data' });
    }

    let shorthand = null;
    let uploadedBytes = 0;
    let diskPath = null;
    let mimeType = null;
    let originalFilename = null;
    let writeStream = null;
    let aborted = false;

    function abort(statusCode, message) {
      if (aborted) return;
      aborted = true;
      // Close and delete partial file
      if (writeStream) {
        writeStream.destroy();
        if (diskPath) try { unlinkSync(diskPath); } catch {}
      }
      if (!res.headersSent) res.status(statusCode).json({ error: message });
    }

    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5 } });
    } catch (err) {
      return res.status(400).json({ error: 'Invalid multipart request' });
    }

    bb.on('field', (name, val) => {
      if (name === 'shorthand') shorthand = val.trim().slice(0, 32);
    });

    bb.on('file', (fieldname, fileStream, info) => {
      if (fieldname !== 'file') {
        fileStream.resume();
        return;
      }

      mimeType = info.mimeType || '';
      originalFilename = info.filename || 'upload';

      // Validate MIME
      if (!ACCEPTED_MIMES.has(mimeType)) {
        fileStream.resume();
        return abort(400, `Unsupported file type: ${mimeType}. Accepted: PNG, WebP, SVG`);
      }

      const ext = MIME_TO_EXT[mimeType] || extname(originalFilename) || '';
      const storedFilename = `${randomUUID()}${ext}`;

      let dir;
      try { dir = ensureImageDir(apiKey); } catch (err) {
        fileStream.resume();
        return abort(500, 'Could not create storage directory');
      }

      diskPath = join(dir, storedFilename);

      try {
        writeStream = createWriteStream(diskPath);
      } catch (err) {
        fileStream.resume();
        return abort(500, 'Could not open file for writing');
      }

      fileStream.on('data', chunk => {
        uploadedBytes += chunk.length;
      });

      fileStream.on('limit', () => {
        abort(413, `File exceeds maximum size of ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB`);
        fileStream.resume();
      });

      fileStream.on('error', () => abort(500, 'File read error'));
      writeStream.on('error', () => abort(500, 'File write error'));

      fileStream.pipe(writeStream);
    });

    bb.on('finish', () => {
      if (aborted) return;

      // Close the write stream before responding
      if (writeStream && !writeStream.writableEnded) {
        writeStream.end(() => finalize());
      } else {
        finalize();
      }
    });

    bb.on('error', (err) => abort(400, `Upload error: ${err.message}`));

    req.pipe(bb);

    function finalize() {
      if (aborted) return;

      // Validate shorthand
      if (!shorthand || !SHORTHAND_RE.test(shorthand)) {
        if (diskPath) try { unlinkSync(diskPath); } catch {}
        return res.status(400).json({ error: 'shorthand is required and must be 1-32 alphanumeric/dash/underscore characters, starting with a letter or digit' });
      }

      if (!mimeType || !ACCEPTED_MIMES.has(mimeType)) {
        if (diskPath) try { unlinkSync(diskPath); } catch {}
        return res.status(400).json({ error: 'No valid image file received' });
      }

      // Check shorthand uniqueness
      if (isShorthandTaken(db, apiKey, shorthand)) {
        if (diskPath) try { unlinkSync(diskPath); } catch {}
        return res.status(409).json({ error: `Shorthand '${shorthand}' is already in use for this key` });
      }

      // Re-check quota including this file (race condition guard)
      const nowUsed = getTotalImageStorageBytes(db, apiKey);
      if (nowUsed + uploadedBytes > MAX_STORAGE_BYTES) {
        if (diskPath) try { unlinkSync(diskPath); } catch {}
        return res.status(413).json({ error: 'Storage quota would be exceeded' });
      }

      const storedFilename = basename(diskPath);
      const id = registerImage(db, {
        apiKey,
        filename: storedFilename,
        shorthand,
        mimeType,
        sizeBytes: uploadedBytes,
      });

      return res.status(201).json({
        ok: true,
        image: { id, shorthand, filename: storedFilename, mimeType, sizeBytes: uploadedBytes },
      });
    }
  });

  // GET /images — list (auth required)
  router.get('/', auth, (req, res) => {
    const apiKey = req.session.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Unauthorized' });

    const rows = listImages(db, apiKey);
    const images = rows.map(r => ({
      id: r.id,
      shorthand: r.shorthand,
      filename: r.filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      createdAt: r.created_at,
    }));
    return res.json({ images });
  });

  // GET /images/:id — serve image publicly (no auth — for DSK page pre-loading)
  router.get('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid image id' });

    const row = getImage(db, id);
    if (!row) return res.status(404).json({ error: 'Image not found' });

    const safe = row.api_key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    const safeFilename = basename(row.filename);
    const filepath = join(GRAPHICS_BASE_DIR, safe, safeFilename);

    if (!existsSync(filepath)) return res.status(404).json({ error: 'Image file not found on disk' });

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Allow cross-origin loading from the DSK page (different subdomain / OBS)
    res.setHeader('Access-Control-Allow-Origin', '*');

    try { res.setHeader('Content-Length', statSync(filepath).size); } catch {}

    createReadStream(filepath).pipe(res);
  });

  // DELETE /images/:id — delete (auth required)
  router.delete('/:id', auth, (req, res) => {
    const apiKey = req.session.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Unauthorized' });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid image id' });

    const row = deleteImage(db, id, apiKey);
    if (!row) return res.status(404).json({ error: 'Image not found' });

    // Best-effort disk deletion
    try {
      const safe = row.api_key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
      const filepath = join(GRAPHICS_BASE_DIR, safe, basename(row.filename));
      if (existsSync(filepath)) unlinkSync(filepath);
    } catch (e) {
      console.warn('[images] Could not delete disk file:', e.message);
    }

    return res.json({ ok: true });
  });

  return router;
}
