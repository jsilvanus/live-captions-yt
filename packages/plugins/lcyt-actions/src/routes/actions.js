/**
 * Named-action definition CRUD.
 *
 *   GET    /actions            — list this project's named actions
 *   POST   /actions            — create { name, slug, definition?, description? }
 *   GET    /actions/:slug      — one
 *   PUT    /actions/:slug      — update { name?, slug?, definition?, description? }
 *   DELETE /actions/:slug      — remove
 *
 *   POST   /actions/run        — run a named action or inline expression on the
 *                                server { ref? | expr?, stopOnError? } (production tier)
 *
 * CRUD is storage only. `/run` executes server atoms (camera, mixer, crop, api,
 * wait) through the injected ActionExecutor and returns client atoms (audio,
 * section, variables, …) for the caller's browser to apply.
 */
import { Router } from 'express';
import crypto from 'crypto';
import {
  listActionDefs, getActionDefBySlug, createActionDef, updateActionDef,
  deleteActionDef, serializeActionDef,
} from '../db.js';
import { requireApiKey, isValidSlug } from './helpers.js';
import { createAuthoringGuard } from '../authoring-guard.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 */
export function createActionsRouter(db, auth, opts = {}) {
  const { executor = null, checkProjectRole = null } = opts;
  const guard = createAuthoringGuard({ executor, checkProjectRole });
  const router = Router();

  // Saved definitions keep camera/mixer/preset ids so a rename cannot break
  // them; responses show the current labels again (executor.rewriteDeviceRefs).
  const toIds = (apiKey, expr) => executor?.rewriteDeviceRefs?.(apiKey, expr, 'ids') ?? expr;
  const present = (apiKey, row) => {
    const out = serializeActionDef(row);
    if (out && executor?.rewriteDeviceRefs) out.definition = executor.rewriteDeviceRefs(apiKey, out.definition, 'labels');
    return out;
  };

  // Same operator+ gate as the DSK activate routes: session/device callers pass,
  // user JWT callers need the 'production' tier.
  function requireProduction(req, res, next) {
    if (!req.user?.userId) return next();
    if (typeof checkProjectRole !== 'function' || !checkProjectRole('production', req.session?.apiKey, req.user.userId)) {
      return res.status(403).json({ error: 'Explicit project operator+ access required' });
    }
    next();
  }

  // Registered before '/:slug' so 'run' is not read as a slug.
  router.post('/run', auth, requireProduction, async (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    if (!executor) return res.status(503).json({ error: 'Action runner is not available' });
    const { ref, expr, stopOnError } = req.body || {};
    if (!ref && !expr) return res.status(400).json({ error: 'ref or expr is required' });
    const result = await executor.run(apiKey, { ref, expr }, { source: 'api', stopOnError: stopOnError === true });
    if (result.ok === false && !result.steps) {
      return res.status(result.code === 'not_found' ? 404 : 400).json({ error: result.error });
    }
    res.json(result);
  });

  router.get('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    res.json({ actions: listActionDefs(db, apiKey).map((r) => present(apiKey, r)) });
  });

  router.post('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { name, slug, definition, description } = req.body || {};
    const denied = guard(req, apiKey, definition);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!isValidSlug(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
    if (getActionDefBySlug(db, apiKey, slug)) return res.status(409).json({ error: `Action slug already in use: ${slug}` });
    const row = createActionDef(db, apiKey, { id: crypto.randomUUID(), name, slug, definition: toIds(apiKey, definition), description });
    res.status(201).json({ action: present(apiKey, row) });
  });

  router.get('/:slug', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const row = getActionDefBySlug(db, apiKey, req.params.slug);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ action: present(apiKey, row) });
  });

  router.put('/:slug', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const existing = getActionDefBySlug(db, apiKey, req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, slug, definition, description } = req.body || {};
    const denied = guard(req, apiKey, definition);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    if (slug !== undefined && !isValidSlug(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
    if (slug !== undefined && slug !== existing.slug && getActionDefBySlug(db, apiKey, slug)) {
      return res.status(409).json({ error: `Action slug already in use: ${slug}` });
    }
    const row = updateActionDef(db, existing.id, { name, slug, definition: toIds(apiKey, definition), description });
    res.json({ action: present(apiKey, row) });
  });

  router.delete('/:slug', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const existing = getActionDefBySlug(db, apiKey, req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    deleteActionDef(db, existing.id);
    res.json({ ok: true });
  });

  return router;
}
