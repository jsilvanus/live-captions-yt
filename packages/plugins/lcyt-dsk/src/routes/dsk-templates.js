/**
 * Authenticated DSK template management and renderer control endpoints.
 *
 * All routes require a valid JWT Bearer token (same auth as /captions etc.).
 * The API key comes from req.session.apiKey set by the auth middleware.
 *
 * Template CRUD:
 * GET    /dsk/:apikey/templates               — list templates (name, id, updated_at)
 * POST   /dsk/:apikey/templates               — create / update template by name
 * GET    /dsk/:apikey/templates/:id           — fetch template JSON payload
 * DELETE /dsk/:apikey/templates/:id           — delete template
 * POST   /dsk/:apikey/templates/:id/activate  — render template in Playwright renderer
 *
 * Renderer control:
 * POST   /dsk/:apikey/renderer/start          — start PNG capture loop → ffmpeg → RTMP;
 *                                               also calls relayManager.setDskRtmpSource()
 *                                               directly so no nginx on_publish is needed
 * POST   /dsk/:apikey/renderer/stop           — stop capture loop and ffmpeg;
 *                                               clears relayManager DSK RTMP source
 *
 * Broadcast control:
 * POST   /dsk/:apikey/template               — activate template by id { id } (convenience alias)
 * POST   /dsk/:apikey/broadcast              — inject live data without page reload:
 *                                               { updates: [{ selector, text }, ...] }
 *                                               uses page.evaluate() so animations keep running
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {object} relayManager
 */
import { Router } from 'express';
import {
  saveTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  findTemplatesWithAnyElementIds,
  autoRenameConflictingIds,
} from '../db/dsk-templates.js';
import { updateTemplate, startRtmpStream, stopRtmpStream, broadcastData, getStatus } from '../renderer.js';
import { editorAuthOrBearer } from '../middleware/editor-auth.js';

// Local RTMP base URL — matches the env vars used by dsk-rtmp.js
const LOCAL_RTMP_BASE = process.env.DSK_LOCAL_RTMP || process.env.RADIO_LOCAL_RTMP || 'rtmp://127.0.0.1:1935';
const DSK_RTMP_APP    = process.env.DSK_RTMP_APP   || 'dsk';

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/;

export function createDskTemplatesRouter(db, auth, editorAuth, relayManager, store) {
  const router = Router();
  const combinedAuth = editorAuthOrBearer(auth, editorAuth);

  // Verify that the token owner matches the URL apikey (prevents cross-key access).
  function checkOwner(req, res, paramKey) {
    if (req.session.apiKey !== paramKey) {
      res.status(403).json({ error: 'Forbidden' });
      return false;
    }
    return true;
  }

  // GET /dsk/:apikey/templates
  router.get('/:apikey/templates', combinedAuth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const rows = listTemplates(db, req.params.apikey);
    res.json({ templates: rows });
  });

  // POST /dsk/:apikey/templates  { name, template }
  router.post('/:apikey/templates', combinedAuth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { name, template } = req.body || {};

    if (!name || !NAME_RE.test(name)) {
      return res.status(400).json({ error: 'name must be 1-64 alphanumeric/space/dash/underscore chars' });
    }
    if (!template || typeof template !== 'object') {
      return res.status(400).json({ error: 'template must be a JSON object' });
    }

    try {
      // Auto-rename conflicting element ids instead of rejecting
      const { updatedTemplateJson, renameMap } = autoRenameConflictingIds(db, req.params.apikey, template);
      const id = saveTemplate(db, { apiKey: req.params.apikey, name, templateJson: updatedTemplateJson });
      const resp = { ok: true, id, name };
      if (Object.keys(renameMap).length > 0) resp.renames = renameMap;
      res.status(201).json(resp);
    } catch (err) {
      console.error('[dsk-templates] saveTemplate error:', err.message);
      res.status(500).json({ error: 'Failed to save template' });
    }
  });

  // GET /dsk/:apikey/templates/:id
  router.get('/:apikey/templates/:id', combinedAuth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const row = getTemplate(db, id, req.params.apikey);
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: row });
  });

  // DELETE /dsk/:apikey/templates/:id
  router.delete('/:apikey/templates/:id', combinedAuth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const deleted = deleteTemplate(db, id, req.params.apikey);
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  });

  // PUT /dsk/:apikey/templates/:id — update template name and/or JSON payload
  router.put('/:apikey/templates/:id', combinedAuth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const { name, template } = req.body || {};
    if (!name && !template) return res.status(400).json({ error: 'Provide name and/or template' });
    if (name && !NAME_RE.test(name)) {
      return res.status(400).json({ error: 'name must be 1-64 alphanumeric/space/dash/underscore chars' });
    }

    const existing = getTemplate(db, id, req.params.apikey);
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const updatedName = name ?? existing.name;
    const updatedJson = template ?? existing.templateJson;
    try {
      // Auto-rename conflicting element ids instead of rejecting
      const { updatedTemplateJson, renameMap } = autoRenameConflictingIds(db, req.params.apikey, updatedJson, id);

      // Direct UPDATE by id so renaming works without creating a duplicate record
      db.prepare(
        "UPDATE dsk_templates SET name = ?, template_json = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(updatedName, JSON.stringify(updatedTemplateJson), id);
      const resp = { ok: true, id, name: updatedName };
      if (Object.keys(renameMap).length > 0) resp.renames = renameMap;
      res.json(resp);
    } catch (err) {
      console.error('[dsk-templates] PUT error:', err.message);
      res.status(500).json({ error: 'Failed to update template' });
    }
  });

  // POST /dsk/:apikey/templates/:id/activate — load template into Playwright renderer
  router.post('/:apikey/templates/:id/activate', combinedAuth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const row = getTemplate(db, id, req.params.apikey);
    if (!row) return res.status(404).json({ error: 'Template not found' });

    // Update server-side renderer — non-fatal if renderer has not been started
    let rendererOk = true;
    try { await updateTemplate(req.params.apikey, row.templateJson); } catch { rendererOk = false; }
    res.json({ ok: true, id, name: row.name, rendererOk });
  });

  // POST /dsk/:apikey/template — activate template by id (convenience alias for /templates/:id/activate)
  // Body: { id: number }
  router.post('/:apikey/template', combinedAuth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.body?.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id must be a number' });

    const row = getTemplate(db, id, req.params.apikey);
    if (!row) return res.status(404).json({ error: 'Template not found' });

    // Update server-side renderer — non-fatal if renderer has not been started
    let rendererOk = true;
    try { await updateTemplate(req.params.apikey, row.templateJson); } catch { rendererOk = false; }
    res.json({ ok: true, id, name: row.name, rendererOk });
  });

  // POST /dsk/:apikey/broadcast — inject live data via page.evaluate() without page reload.
  // Animations keep running; only the targeted DOM elements are updated.
  // Body: { templateIds?: number[], updates?: [{ selector, text }, ...] }
  //   or: { selector: string, text: string }  (single-item shorthand, no templateIds)
  //   or: { templateIds: number[] }            (template-push only, no text updates)
  router.post('/:apikey/broadcast', combinedAuth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { updates, selector, text, templateId, templateIds } = req.body || {};

    // Build update items — allow empty list when templateIds is provided
    const items = updates ?? (selector != null ? [{ selector, text }] : []);
    const idList = Array.isArray(templateIds)
      ? templateIds.map(Number).filter(n => Number.isInteger(n))
      : templateId != null ? [Number(templateId)].filter(n => Number.isInteger(n)) : [];

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'updates must be an array' });
    }
    if (items.length === 0 && idList.length === 0) {
      return res.status(400).json({ error: 'Provide updates array, {selector, text}, or templateIds' });
    }
    for (const item of items) {
      if (typeof item.selector !== 'string' || !item.selector) {
        return res.status(400).json({ error: 'Each update must have a non-empty selector string' });
      }
    }

    // Push to client-side overlay subscribers via SSE
    if (store) {
      if (idList.length > 0) {
        const templateJsons = idList
          .map(id => getTemplate(db, id, req.params.apikey))
          .filter(Boolean)
          .map(row => row.templateJson);
        if (templateJsons.length > 0) {
          store.emitDskEvent(req.params.apikey, 'templates', { templates: templateJsons, ts: Date.now() });
        }
      }
      if (items.length > 0) {
        const layerUpdates = items.map(({ selector, text }) => ({
          id: selector.startsWith('#') ? selector.slice(1) : selector,
          text,
        }));
        store.emitDskEvent(req.params.apikey, 'layer_update', { updates: layerUpdates, ts: Date.now() });
      }
    }

    // Server-side renderer: activate the last selected template, then inject text
    if (idList.length > 0) {
      const lastRow = getTemplate(db, idList[idList.length - 1], req.params.apikey);
      if (lastRow) {
        try { await updateTemplate(req.params.apikey, lastRow.templateJson); } catch { /* non-fatal */ }
      }
    }
    try {
      if (items.length > 0) await broadcastData(req.params.apikey, items);
      res.json({ ok: true, updated: items.length, templates: idList.length });
    } catch (err) {
      console.error(`[dsk-templates] broadcast error:`, err.message);
      res.status(500).json({ error: 'Failed to broadcast data' });
    }
  });

  // GET /dsk/:apikey/renderer/status — health check: is the renderer running for this key?
  router.get('/:apikey/renderer/status', combinedAuth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const status = getStatus(req.params.apikey);
    res.json(status);
  });

  // POST /dsk/:apikey/renderer/start — begin Playwright capture loop → ffmpeg → RTMP
  // Also calls relayManager.setDskRtmpSource() directly so the ffmpeg overlay compositing
  // picks up the Playwright stream immediately without waiting for nginx on_publish.
  router.post('/:apikey/renderer/start', combinedAuth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const apiKey = req.params.apikey;
    const rtmpUrl = `${LOCAL_RTMP_BASE}/${DSK_RTMP_APP}/${apiKey}`;

    try {
      await startRtmpStream(apiKey, LOCAL_RTMP_BASE, DSK_RTMP_APP);
      // Wire the Playwright RTMP output directly into the relay overlay pipeline.
      if (relayManager) {
        await relayManager.setDskRtmpSource(apiKey, rtmpUrl);
      }
      res.json({ ok: true, rtmpUrl });
    } catch (err) {
      console.error(`[dsk-renderer] start error for ${apiKey}:`, err.message);
      res.status(500).json({ error: 'Failed to start renderer stream' });
    }
  });

  // POST /dsk/:apikey/graphics — manually push a 'graphics' SSE event to all client-side overlay
  // subscribers, updating which image shorthands are visible on /dsk/:key pages.
  // Body: { default?: string[], viewports?: { [name]: string[] } }
  router.post('/:apikey/graphics', combinedAuth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { default: defaultNames, viewports } = req.body || {};

    const newState = {
      default: Array.isArray(defaultNames) ? defaultNames : [],
      viewports: (viewports && typeof viewports === 'object' && !Array.isArray(viewports)) ? viewports : {},
    };

    if (store) {
      store.setDskGraphicsState(req.params.apikey, newState);
      store.emitDskEvent(req.params.apikey, 'graphics', { ...newState, ts: Date.now() });
    }

    res.json({ ok: true, ...newState });
  });

  // POST /dsk/:apikey/renderer/stop — tear down capture loop and ffmpeg
  // Also clears the DSK RTMP source in relayManager so the relay reverts to copy mode.
  router.post('/:apikey/renderer/stop', combinedAuth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const apiKey = req.params.apikey;

    try {
      await stopRtmpStream(apiKey);
      if (relayManager) {
        await relayManager.setDskRtmpSource(apiKey, null);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error(`[dsk-renderer] stop error for ${apiKey}:`, err.message);
      res.status(500).json({ error: 'Failed to stop renderer stream' });
    }
  });

  return router;
}
