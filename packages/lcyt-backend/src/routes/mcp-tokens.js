/**
 * Personal MCP access token routes (plan/mcp).
 *
 * Named, individually-revocable bearer tokens a project owner generates and
 * pastes into a local MCP client config (Claude Desktop, Claude Code).
 *
 *   POST   /mcp-tokens      — { label } → { id, token }  (raw token returned once)
 *   GET    /mcp-tokens      — list (label + timestamps; hash/raw never returned)
 *   DELETE /mcp-tokens/:id  — revoke
 *
 * All routes require session JWT Bearer auth; tokens are scoped to the
 * session's api_key.
 */

import { Router } from 'express';
import { createMcpToken, listMcpTokens, revokeMcpToken } from '../db/mcp-tokens.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — session JWT middleware
 * @returns {import('express').Router}
 */
export function createMcpTokensRouter(db, auth) {
  const router = Router();
  router.use(auth);

  router.post('/', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (!label) return res.status(400).json({ error: 'label is required' });
    if (label.length > 100) return res.status(400).json({ error: 'label must be 100 characters or fewer' });
    const { id, token } = createMcpToken(db, apiKey, label);
    res.status(201).json({ ok: true, id, token });
  });

  router.get('/', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    res.json({ ok: true, tokens: listMcpTokens(db, apiKey) });
  });

  router.delete('/:id', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid token id' });
    const revoked = revokeMcpToken(db, apiKey, id);
    if (!revoked) return res.status(404).json({ error: 'Token not found' });
    res.json({ ok: true });
  });

  return router;
}
