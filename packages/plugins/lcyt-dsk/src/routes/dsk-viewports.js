/**
 * Authenticated viewport management endpoints.
 *
 * All routes require a valid JWT Bearer token.
 * The API key comes from req.session.apiKey set by the auth middleware.
 *
 * GET    /dsk/:apikey/viewports           — list user-defined viewports
 * POST   /dsk/:apikey/viewports           — create viewport
 * PUT    /dsk/:apikey/viewports/:name     — update viewport label/type/dimensions
 * DELETE /dsk/:apikey/viewports/:name     — delete viewport
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 */
import { Router } from 'express';
import { listViewports, getViewport, upsertViewport, deleteViewport } from '../db/viewports.js';

// Viewport name must be a lowercase slug (letters, digits, hyphens, underscores)
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function createDskViewportsRouter(db, auth) {
  const router = Router();

  function checkOwner(req, res, paramKey) {
    if (req.session.apiKey !== paramKey) {
      res.status(403).json({ error: 'Forbidden' });
      return false;
    }
    return true;
  }

  // GET /dsk/:apikey/viewports
  router.get('/:apikey/viewports', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const rows = listViewports(db, req.params.apikey);
    res.json({ viewports: rows.map(formatViewport) });
  });

  // POST /dsk/:apikey/viewports
  router.post('/:apikey/viewports', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { name, label, viewportType, width, height, textLayers } = req.body ?? {};

    if (!name || !SLUG_RE.test(name)) {
      return res.status(400).json({ error: 'name must be a lowercase slug (letters, digits, hyphens, underscores)' });
    }
    if (name === 'public') {
      return res.status(400).json({ error: 'Reserved viewport name' });
    }
    const vt = viewportType ?? 'landscape';
    if (!['landscape', 'vertical'].includes(vt)) {
      return res.status(400).json({ error: 'viewportType must be landscape or vertical' });
    }
    const w = parseInt(width, 10) || (vt === 'vertical' ? 1080 : 1920);
    const h = parseInt(height, 10) || (vt === 'vertical' ? 1920 : 1080);

    const existing = getViewport(db, req.params.apikey, name);
    if (existing) {
      return res.status(409).json({ error: 'Viewport with this name already exists' });
    }

    const textLayersJson = Array.isArray(textLayers) ? JSON.stringify(textLayers) : null;
    const row = upsertViewport(db, req.params.apikey, { name, label, viewportType: vt, width: w, height: h, textLayersJson });
    res.status(201).json({ viewport: formatViewport(row) });
  });

  // PUT /dsk/:apikey/viewports/:name
  router.put('/:apikey/viewports/:name', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { name } = req.params;
    const existing = getViewport(db, req.params.apikey, name);
    if (!existing) return res.status(404).json({ error: 'Viewport not found' });

    const { label, viewportType, width, height, textLayers } = req.body ?? {};
    const vt = viewportType ?? existing.viewport_type;
    if (!['landscape', 'vertical'].includes(vt)) {
      return res.status(400).json({ error: 'viewportType must be landscape or vertical' });
    }

    const textLayersJson = Array.isArray(textLayers)
      ? JSON.stringify(textLayers)
      : (textLayers === null ? null : existing.text_layers_json ?? null);

    const row = upsertViewport(db, req.params.apikey, {
      name,
      label:           label        !== undefined ? label        : existing.label,
      viewportType:    vt,
      width:           width        !== undefined ? (parseInt(width, 10)  || existing.width)  : existing.width,
      height:          height       !== undefined ? (parseInt(height, 10) || existing.height) : existing.height,
      textLayersJson,
    });
    res.json({ viewport: formatViewport(row) });
  });

  // DELETE /dsk/:apikey/viewports/:name
  router.delete('/:apikey/viewports/:name', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const deleted = deleteViewport(db, req.params.apikey, req.params.name);
    if (!deleted) return res.status(404).json({ error: 'Viewport not found' });
    res.json({ ok: true });
  });

  return router;
}

function formatViewport(row) {
  return {
    id:           row.id,
    name:         row.name,
    label:        row.label ?? null,
    viewportType: row.viewport_type,
    width:        row.width,
    height:       row.height,
    textLayers:   parseJsonArray(row.text_layers_json),
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

function parseJsonArray(str) {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
}
