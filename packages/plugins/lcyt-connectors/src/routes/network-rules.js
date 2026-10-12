/**
 * Outbound connector network policy CRUD — see network-guard.js for the
 * rule-evaluation semantics these rows drive.
 *
 * Two routers, two auth models:
 *   - createGlobalNetworkRulesRouter — site-wide rules, admin only
 *     (mounted at /admin/connector-network-rules by lcyt-backend, using its
 *     existing createAdminMiddleware — X-Admin-Key or an is_admin user).
 *   - createOrgNetworkRulesRouter — per-organization rules, enforced for
 *     every connector belonging to a project in that org. Any org member can
 *     view; only the org's owner or an 'admin' org_members row can write
 *     (mounted with lcyt-backend's createUserAuthMiddleware — a logged-in
 *     user, not a project session token).
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { listNetworkRules, createNetworkRule, getNetworkRule, deleteNetworkRule, getOrgRole } from '../db.js';

const VALID_RULE_TYPES = ['allow', 'deny'];

function validateBody(body) {
  const { ruleType, pattern } = body || {};
  if (!VALID_RULE_TYPES.includes(ruleType)) return `ruleType must be one of: ${VALID_RULE_TYPES.join(', ')}`;
  if (!pattern || typeof pattern !== 'string') return 'pattern is required';
  return null;
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {import('express').RequestHandler} adminAuth
 */
export function createGlobalNetworkRulesRouter(db, adminAuth) {
  const router = Router();
  router.use(adminAuth);

  router.get('/', async (req, res) => {
    res.json({ rules: await listNetworkRules(db, { scope: 'global' }) });
  });

  router.post('/', async (req, res) => {
    const error = validateBody(req.body);
    if (error) return res.status(400).json({ error });
    const { ruleType, pattern, description } = req.body;
    const row = await createNetworkRule(db, {
      id: randomUUID(), scope: 'global', ruleType, pattern, description,
      createdBy: req.adminUser?.userId ?? null,
    });
    res.status(201).json({ rule: row });
  });

  router.delete('/:id', async (req, res) => {
    const rule = await getNetworkRule(db, req.params.id);
    if (!rule || rule.scope !== 'global') return res.status(404).json({ error: 'Unknown rule' });
    await deleteNetworkRule(db, rule.id);
    res.json({ ok: true });
  });

  return router;
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {import('express').RequestHandler} userAuth
 */
export function createOrgNetworkRulesRouter(db, userAuth) {
  const router = Router();
  router.use(userAuth);

  async function requireOrgRole(req, res, allowedRoles) {
    const orgId = Number(req.params.orgId);
    if (!Number.isFinite(orgId)) {
      res.status(400).json({ error: 'Invalid org ID' });
      return null;
    }
    const role = await getOrgRole(db, req.user.userId, orgId);
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({ error: 'Not authorized for this organization' });
      return null;
    }
    return orgId;
  }

  router.get('/orgs/:orgId/connector-network-rules', async (req, res) => {
    const orgId = await requireOrgRole(req, res, ['owner', 'admin', 'member']);
    if (orgId == null) return;
    res.json({ rules: await listNetworkRules(db, { scope: 'org', orgId }) });
  });

  router.post('/orgs/:orgId/connector-network-rules', async (req, res) => {
    const orgId = await requireOrgRole(req, res, ['owner', 'admin']);
    if (orgId == null) return;
    const error = validateBody(req.body);
    if (error) return res.status(400).json({ error });
    const { ruleType, pattern, description } = req.body;
    const row = await createNetworkRule(db, {
      id: randomUUID(), scope: 'org', orgId, ruleType, pattern, description,
      createdBy: req.user.userId,
    });
    res.status(201).json({ rule: row });
  });

  router.delete('/orgs/:orgId/connector-network-rules/:id', async (req, res) => {
    const orgId = await requireOrgRole(req, res, ['owner', 'admin']);
    if (orgId == null) return;
    const rule = await getNetworkRule(db, req.params.id);
    if (!rule || rule.scope !== 'org' || rule.org_id !== orgId) return res.status(404).json({ error: 'Unknown rule' });
    await deleteNetworkRule(db, rule.id);
    res.json({ ok: true });
  });

  return router;
}
