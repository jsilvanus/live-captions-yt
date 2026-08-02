/**
 * AI Roles Framework routes (plan/ai_roles_framework).
 *
 *   GET  /roles/catalog          — list ai_roles catalog (public, like GET /ai/status —
 *                                  drives the frontend role picker before a project logs in)
 *   GET  /roles/:roleCode/config — get the session project's config for a role
 *   PUT  /roles/:roleCode/config — update it
 *
 * Runtime-specific routes (tracker/describer start/stop, role message/assist,
 * assistant suggestions) are added by later phases — this router only owns
 * the catalog + config CRUD common to every role.
 */

import { Router } from 'express';
import { listRoles, getRole, getRoleConfig, setRoleConfig } from '../ai-roles.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — session JWT middleware
 * @param {{ checkProjectRole?: (tier: string, apiKey: string, userId: number) => boolean }} [deps]
 * @returns {import('express').Router}
 */
export function createRolesRouter(db, auth, deps = {}) {
  const router = Router();

  /**
   * Picking a provider/model per role is a Setup Hub card action
   * (plan_project_roles.md, decided 2026-07-26) — not itself credential-
   * bearing (the provider row already exists elsewhere), but still gated at
   * 'setup' tier for consistency with every other Setup-shaped route. GET
   * stays open to any project member. lcyt-agent has no direct access to
   * lcyt-backend's project_members table (plugin boundary), so this check is
   * injected from the composition root — same shape as ai-providers-project.js's
   * requireExplicitAdmin.
   */
  function requireSetup(req, res, next) {
    const apiKey = req.session?.apiKey;
    if (typeof deps.checkProjectRole !== 'function' || !req.user?.userId || !deps.checkProjectRole('setup', apiKey, req.user.userId)) {
      return res.status(403).json({ error: 'Explicit project admin/owner access required' });
    }
    next();
  }

  router.get('/catalog', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=3600');
    res.json({ ok: true, roles: listRoles(db) });
  });

  router.get('/:roleCode/config', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    if (!getRole(db, req.params.roleCode)) return res.status(404).json({ error: 'Unknown role' });
    res.json({ ok: true, config: getRoleConfig(db, apiKey, req.params.roleCode) });
  });

  router.put('/:roleCode/config', auth, requireSetup, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    if (!getRole(db, req.params.roleCode)) return res.status(404).json({ error: 'Unknown role' });

    const { enabled, providerId, modelName, harnessConfig } = req.body || {};
    if (harnessConfig !== undefined && (typeof harnessConfig !== 'object' || harnessConfig === null || Array.isArray(harnessConfig))) {
      return res.status(400).json({ error: 'harnessConfig must be an object' });
    }
    const config = setRoleConfig(db, apiKey, req.params.roleCode, { enabled, providerId, modelName, harnessConfig });
    res.json({ ok: true, config });
  });

  return router;
}
