/**
 * External token routes.
 *
 * Named, individually-revocable bearer tokens a project owner generates and
 * pastes into a local client config (Claude Desktop, Claude Code, or similar).
 * Backing store for the Setup Hub "external access" card.
 *
 *   POST   /external-tokens      — { label, active?, createdByName?, projectId?, scopes? } → { id, token, ... }
 *   GET    /external-tokens      — list (label + active + timestamps; hash/raw never returned)
 *   PATCH  /external-tokens/:id  — update label / soft active-toggle / creator name / scopes
 *   DELETE /external-tokens/:id  — permanently revoke
 *
 * All routes require a project-scoped access credential and an explicit
 * project context via X-Project-Id (or request body/query/project params).
 */

import { Router } from 'express';
import { createMcpToken, listMcpTokens, updateMcpToken, revokeMcpToken } from '../db/mcp-tokens.js';
import { getMemberAccessLevel } from '../db/project-members.js';

const EXPLICIT_ADMIN_LEVELS = new Set(['owner', 'admin']);

/**
 * A personal MCP access token is a durable, exportable credential — minting
 * or revoking one is a Setup-tier action, so org-baseline access (granted
 * automatically to any org member via getEffectiveProjectAccessLevel()) is
 * not enough; it requires an explicit project_members owner/admin row for
 * the authenticated user. GET (listing) stays reachable to anyone who
 * already passed the broader project-access gate.
 */
function requireExplicitAdmin(db) {
  return (req, res, next) => {
    const projectId = req.auth?.projectId || resolveProjectId(req);
    // No projectId at all is the route handler's own 400 to raise, not this
    // gate's 403 — let it through unchanged.
    if (!projectId) return next();
    const userId = req.user?.userId;
    const level = userId ? getMemberAccessLevel(db, projectId, userId) : null;
    if (!level || !EXPLICIT_ADMIN_LEVELS.has(level)) {
      return res.status(403).json({ error: 'Explicit project owner/admin access required' });
    }
    next();
  };
}

function resolveProjectId(req) {
  const header = req.headers['x-project-id'] || req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const bodyKey = req.body?.projectId || req.body?.project_id || req.body?.apiKey || req.body?.api_key;
  if (typeof bodyKey === 'string' && bodyKey.trim()) return bodyKey.trim();
  const queryKey = req.query?.projectId || req.query?.project_id || req.query?.apiKey || req.query?.api_key;
  if (typeof queryKey === 'string' && queryKey.trim()) return queryKey.trim();
  return req.params?.projectId || req.params?.project_id || req.params?.apiKey || req.params?.api_key || req.params?.key || null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — project-scoped access middleware
 * @returns {import('express').Router}
 */
export function createExternalTokensRouter(db, auth) {
  const router = Router();
  router.use(auth);
  const explicitAdmin = requireExplicitAdmin(db);

  router.post('/', explicitAdmin, (req, res) => {
    const projectId = req.auth?.projectId || resolveProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (!label) return res.status(400).json({ error: 'label is required' });
    if (label.length > 100) return res.status(400).json({ error: 'label must be 100 characters or fewer' });

    try {
      const created = createMcpToken(db, projectId, {
        label,
        active: req.body?.active,
        createdByName: req.body?.createdByName || req.body?.created_by_name,
        createdByEmail: req.user?.email,
        createdByUserId: req.user?.userId ?? null,
        userId: req.user?.userId ?? null,
        projectId,
        scopes: req.body?.scopes,
      });
      return res.status(201).json({ ok: true, ...created });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.get('/', (req, res) => {
    const projectId = req.auth?.projectId || resolveProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    return res.json({ ok: true, tokens: listMcpTokens(db, projectId) });
  });

  router.patch('/:id', explicitAdmin, (req, res) => {
    const projectId = req.auth?.projectId || resolveProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid token id' });

    const updated = updateMcpToken(db, projectId, id, {
      label: req.body?.label,
      active: req.body?.active,
      createdByName: req.body?.createdByName || req.body?.created_by_name,
      scopes: req.body?.scopes,
    });
    if (!updated) return res.status(404).json({ error: 'Token not found' });
    return res.json({ ok: true, ...updated });
  });

  router.delete('/:id', explicitAdmin, (req, res) => {
    const projectId = req.auth?.projectId || resolveProjectId(req);
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid token id' });
    const revoked = revokeMcpToken(db, projectId, id);
    if (!revoked) return res.status(404).json({ error: 'Token not found' });
    res.json({ ok: true });
  });

  return router;
}

export const createMcpTokensRouter = createExternalTokensRouter;
