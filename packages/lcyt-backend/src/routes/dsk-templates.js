/**
 * Authenticated DSK template management endpoints.
 *
 * All routes require a valid JWT Bearer token (same auth as /captions etc.).
 * The API key comes from req.session.apiKey set by the auth middleware.
 *
 * GET    /dsk/:apikey/templates         — list templates (name, id, updated_at)
 * POST   /dsk/:apikey/templates         — create / update template by name
 * GET    /dsk/:apikey/templates/:id     — fetch template JSON payload
 * DELETE /dsk/:apikey/templates/:id     — delete template
 * POST   /dsk/:apikey/templates/:id/activate — render template in Playwright renderer
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {object} renderer  — named exports from dsk-renderer.js
 */
import { Router } from 'express';
import {
  saveTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
} from '../db.js';
import { updateTemplate } from '../dsk-renderer.js';

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/;

export function createDskTemplatesRouter(db, auth) {
  const router = Router();

  // Verify that the token owner matches the URL apikey (prevents cross-key access).
  function checkOwner(req, res, paramKey) {
    if (req.session.apiKey !== paramKey) {
      res.status(403).json({ error: 'Forbidden' });
      return false;
    }
    return true;
  }

  // GET /dsk/:apikey/templates
  router.get('/:apikey/templates', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const rows = listTemplates(db, req.params.apikey);
    res.json({ templates: rows });
  });

  // POST /dsk/:apikey/templates  { name, template }
  router.post('/:apikey/templates', auth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const { name, template } = req.body || {};

    if (!name || !NAME_RE.test(name)) {
      return res.status(400).json({ error: 'name must be 1-64 alphanumeric/space/dash/underscore chars' });
    }
    if (!template || typeof template !== 'object') {
      return res.status(400).json({ error: 'template must be a JSON object' });
    }

    try {
      const id = saveTemplate(db, { apiKey: req.params.apikey, name, templateJson: template });
      res.status(201).json({ ok: true, id, name });
    } catch (err) {
      console.error('[dsk-templates] saveTemplate error:', err.message);
      res.status(500).json({ error: 'Failed to save template' });
    }
  });

  // GET /dsk/:apikey/templates/:id
  router.get('/:apikey/templates/:id', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const row = getTemplate(db, id, req.params.apikey);
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: row });
  });

  // DELETE /dsk/:apikey/templates/:id
  router.delete('/:apikey/templates/:id', auth, (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const deleted = deleteTemplate(db, id, req.params.apikey);
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  });

  // POST /dsk/:apikey/templates/:id/activate — load template into Playwright renderer
  router.post('/:apikey/templates/:id/activate', auth, async (req, res) => {
    if (!checkOwner(req, res, req.params.apikey)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const row = getTemplate(db, id, req.params.apikey);
    if (!row) return res.status(404).json({ error: 'Template not found' });

    try {
      await updateTemplate(req.params.apikey, row.templateJson);
      res.json({ ok: true, id, name: row.name });
    } catch (err) {
      console.error(`[dsk-templates] activate error for key ${req.params.apikey}:`, err.message);
      res.status(500).json({ error: 'Failed to activate template' });
    }
  });

  return router;
}
