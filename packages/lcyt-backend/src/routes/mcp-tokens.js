/**
 * Personal MCP access token routes (plan/mcp).
 *
 * Named, individually-revocable bearer tokens a project owner generates and
 * pastes into a local MCP client config (Claude Desktop, Claude Code).
 * Backing store for the Setup Hub "MCP access" card.
 *
 *   POST   /mcp-tokens      — { label, active?, createdByName? } → { id, token, ... } (raw token returned once)
 *   GET    /mcp-tokens      — list (label + active + timestamps; hash/raw never returned)
 *   PATCH  /mcp-tokens/:id  — update label / soft active-toggle / creator name
 *   DELETE /mcp-tokens/:id  — permanently revoke
 *
 * All routes require a user JWT Bearer token (project-settings style, same
 * as /ai/models — no live caption session required) plus an explicit
 * project api_key via X-Api-Key header, apiKey/api_key body field, or query
 * param.
 */

import { Router } from 'express';
import { createMcpToken, listMcpTokens, updateMcpToken, revokeMcpToken } from '../db/mcp-tokens.js';

function resolveApiKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const bodyKey = req.body?.apiKey || req.body?.api_key;
  if (typeof bodyKey === 'string' && bodyKey.trim()) return bodyKey.trim();
  const queryKey = req.query?.apiKey || req.query?.api_key;
  if (typeof queryKey === 'string' && queryKey.trim()) return queryKey.trim();
  return null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — user JWT middleware
 * @returns {import('express').Router}
 */
export function createMcpTokensRouter(db, auth) {
  const router = Router();
  router.use(auth);

  router.post('/', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (!label) return res.status(400).json({ error: 'label is required' });
    if (label.length > 100) return res.status(400).json({ error: 'label must be 100 characters or fewer' });

    try {
      const created = createMcpToken(db, apiKey, {
        label,
        active: req.body?.active,
        createdByName: req.body?.createdByName || req.body?.created_by_name,
        createdByEmail: req.user?.email,
        createdByUserId: req.user?.userId ?? null,
      });
      return res.status(201).json({ ok: true, ...created });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.get('/', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });
    return res.json({ ok: true, tokens: listMcpTokens(db, apiKey) });
  });

  router.patch('/:id', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid token id' });

    const updated = updateMcpToken(db, apiKey, id, {
      label: req.body?.label,
      active: req.body?.active,
      createdByName: req.body?.createdByName || req.body?.created_by_name,
    });
    if (!updated) return res.status(404).json({ error: 'Token not found' });
    return res.json({ ok: true, ...updated });
  });

  router.delete('/:id', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid token id' });
    const revoked = revokeMcpToken(db, apiKey, id);
    if (!revoked) return res.status(404).json({ error: 'Token not found' });
    res.json({ ok: true });
  });

  return router;
}
