/**
 * Named-action definition CRUD.
 *
 *   GET    /actions            — list this project's named actions
 *   POST   /actions            — create { name, slug, definition?, description? }
 *   GET    /actions/:slug      — one
 *   PUT    /actions/:slug      — update { name?, slug?, definition?, description? }
 *   DELETE /actions/:slug      — remove
 *
 * Storage only — parsing/expansion/execution are client-side.
 */
import { Router } from 'express';
import crypto from 'crypto';
import {
  listActionDefs, getActionDefBySlug, createActionDef, updateActionDef,
  deleteActionDef, serializeActionDef,
} from '../db.js';
import { requireApiKey, isValidSlug } from './helpers.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 */
export function createActionsRouter(db, auth) {
  const router = Router();

  router.get('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    res.json({ actions: listActionDefs(db, apiKey).map(serializeActionDef) });
  });

  router.post('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { name, slug, definition, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!isValidSlug(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
    if (getActionDefBySlug(db, apiKey, slug)) return res.status(409).json({ error: `Action slug already in use: ${slug}` });
    const row = createActionDef(db, apiKey, { id: crypto.randomUUID(), name, slug, definition, description });
    res.status(201).json({ action: serializeActionDef(row) });
  });

  router.get('/:slug', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const row = getActionDefBySlug(db, apiKey, req.params.slug);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ action: serializeActionDef(row) });
  });

  router.put('/:slug', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const existing = getActionDefBySlug(db, apiKey, req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { name, slug, definition, description } = req.body || {};
    if (slug !== undefined && !isValidSlug(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens' });
    if (slug !== undefined && slug !== existing.slug && getActionDefBySlug(db, apiKey, slug)) {
      return res.status(409).json({ error: `Action slug already in use: ${slug}` });
    }
    const row = updateActionDef(db, existing.id, { name, slug, definition, description });
    res.json({ action: serializeActionDef(row) });
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
