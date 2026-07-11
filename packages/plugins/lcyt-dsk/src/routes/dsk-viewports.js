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

// A viewport name becomes the second path segment in /dsk/:slug/:viewport, so
// it must not collide with the sibling sub-routes under /dsk/:apikey/*
// (plan_dsk_viewport_settings Phase 2 — otherwise a viewport named "events"
// would shadow the SSE route). Exported for tests.
export const RESERVED_VIEWPORT_NAMES = new Set([
  'public', 'events', 'images', 'viewports', 'templates', 'template',
  'broadcast', 'renderer', 'renderer_start', 'renderer_stop',
]);

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
    // projectSlug (when set) lets the Viewports page build slug-form display
    // URLs (/dsk/<slug>/<viewport>) without a separate lookup.
    let projectSlug = null;
    try {
      projectSlug = db.prepare('SELECT public_slug FROM api_keys WHERE key = ?').get(req.params.apikey)?.public_slug ?? null;
    } catch { /* pre-migration schema */ }
    res.json({ viewports: rows.map(formatViewport), projectSlug });
  });

  // POST /dsk/:apikey/viewports
  router.post('/:apikey/viewports', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { name, label, viewportType, width, height, textLayers, displaySettings } = req.body ?? {};

    if (!name || !SLUG_RE.test(name)) {
      return res.status(400).json({ error: 'name must be a lowercase slug (letters, digits, hyphens, underscores)' });
    }
    if (RESERVED_VIEWPORT_NAMES.has(name)) {
      return res.status(400).json({ error: `'${name}' is a reserved viewport name` });
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
    const cleanSettings = sanitizeDisplaySettings(displaySettings);
    const displaySettingsJson = cleanSettings ? JSON.stringify(cleanSettings) : null;
    const row = upsertViewport(db, req.params.apikey, { name, label, viewportType: vt, width: w, height: h, textLayersJson, displaySettingsJson });
    res.status(201).json({ viewport: formatViewport(row) });
  });

  // PUT /dsk/:apikey/viewports/:name
  router.put('/:apikey/viewports/:name', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { name } = req.params;
    const existing = getViewport(db, req.params.apikey, name);
    if (!existing) return res.status(404).json({ error: 'Viewport not found' });

    const { label, viewportType, width, height, textLayers, displaySettings } = req.body ?? {};
    const vt = viewportType ?? existing.viewport_type;
    if (!['landscape', 'vertical'].includes(vt)) {
      return res.status(400).json({ error: 'viewportType must be landscape or vertical' });
    }

    const textLayersJson = Array.isArray(textLayers)
      ? JSON.stringify(textLayers)
      : (textLayers === null ? null : existing.text_layers_json ?? null);

    // Coalesce display settings so a text-layers-only PUT (and vice versa)
    // doesn't wipe the other field. `null` explicitly clears.
    let displaySettingsJson;
    if (displaySettings === undefined) {
      displaySettingsJson = existing.display_settings_json ?? null;
    } else if (displaySettings === null) {
      displaySettingsJson = null;
    } else {
      const clean = sanitizeDisplaySettings(displaySettings);
      displaySettingsJson = clean ? JSON.stringify(clean) : null;
    }

    const row = upsertViewport(db, req.params.apikey, {
      name,
      label:           label        !== undefined ? label        : existing.label,
      viewportType:    vt,
      width:           width        !== undefined ? (parseInt(width, 10)  || existing.width)  : existing.width,
      height:          height       !== undefined ? (parseInt(height, 10) || existing.height) : existing.height,
      textLayersJson,
      displaySettingsJson,
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
    id:              row.id,
    name:            row.name,
    label:           row.label ?? null,
    viewportType:    row.viewport_type,
    width:           row.width,
    height:          row.height,
    textLayers:      parseJsonArray(row.text_layers_json),
    displaySettings: sanitizeDisplaySettings(parseJsonObject(row.display_settings_json)),
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

function parseJsonArray(str) {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
}

function parseJsonObject(str) {
  if (!str) return null;
  try { const v = JSON.parse(str); return (v && typeof v === 'object') ? v : null; } catch { return null; }
}

/**
 * Whitelist + clamp display settings (plan_dsk_viewport_settings Phase 3).
 * Returns null when nothing is set. Presentation values only — safe to serve
 * on the public viewports endpoint.
 */
export function sanitizeDisplaySettings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};

  if (typeof raw.background === 'string' && raw.background.trim()) {
    // CSS color or 'transparent'; cap length to avoid style-injection payloads.
    out.background = raw.background.trim().slice(0, 64);
  }
  if (raw.ccMode !== undefined) out.ccMode = !!raw.ccMode;

  if (raw.ccStyle && typeof raw.ccStyle === 'object') {
    const s = raw.ccStyle;
    const cc = {};
    if (Number.isFinite(Number(s.fontSize))) cc.fontSize = Math.max(8, Math.min(200, Math.round(Number(s.fontSize))));
    if (s.position === 'top' || s.position === 'bottom') cc.position = s.position;
    if (typeof s.color === 'string' && s.color.trim()) cc.color = s.color.trim().slice(0, 64);
    if (typeof s.background === 'string' && s.background.trim()) cc.background = s.background.trim().slice(0, 64);
    if (Object.keys(cc).length > 0) out.ccStyle = cc;
  }

  return Object.keys(out).length > 0 ? out : null;
}
