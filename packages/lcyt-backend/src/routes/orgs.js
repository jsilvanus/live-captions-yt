import { Router } from 'express';
import {
  buildUniqueSlug,
  createOrganization,
  createOrganizationMember,
  deleteOrganization,
  getOrgMembership,
  getOrganizationDetails,
  getOrganizationFeatureCodes,
  getOrganizationMember,
  listOrganizationMembers,
  listOrganizationProjects,
  listOrganizationsForUser,
  removeOrganizationMember,
  setOrganizationFeatureCodes,
  updateOrganization,
  updateOrganizationMemberRole,
} from '../db/orgs.js';
import { getUserByEmail } from '../db/users.js';
import { queryAuditLog } from '../db/audit-log.js';
import { queryRollupSeries } from '../db/usage-rollups.js';

const ROLE_ORDER = ['owner', 'admin', 'editor', 'operator', 'viewer'];

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'team';
}

function canManageMembers(role) {
  return role === 'owner' || role === 'admin';
}

export function createOrganizationsRouter(db, authMiddleware, { loginEnabled = false } = {}) {
  const router = Router();

  router.use((req, res, next) => {
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    authMiddleware(req, res, next);
  });

  router.get('/', (req, res) => {
    const rows = listOrganizationsForUser(db, req.user.userId);
    return res.json({ organizations: rows });
  });

  router.post('/', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const slug = buildUniqueSlug(db, name);
    const created = createOrganization(db, { name, slug, ownerUserId: req.user.userId });
    return res.status(201).json({ organization: created });
  });

  router.get('/:id', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const details = getOrganizationDetails(db, orgId);
    return res.json({ organization: details, role: membership.role });
  });

  // GET /orgs/:id/audit — org audit trail (owner/admin only; plan_metering_audit §5.5)
  router.get('/:id/audit', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (!canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { rows, total } = queryAuditLog(db, {
      orgId,
      q:      (req.query.q      || '').trim(),
      action: (req.query.action || '').trim(),
      apiKey: (req.query.apiKey || '').trim(),
      from:   (req.query.from   || '').trim(),
      to:     (req.query.to     || '').trim(),
      limit,
      offset,
    });
    const entries = rows.map(r => {
      let details = null;
      try { if (r.details) details = JSON.parse(r.details); } catch {}
      return { ...r, details };
    });
    return res.json({ entries, total, limit, offset });
  });

  // GET /orgs/:id/usage — usage rollups for the org's projects
  // (plan_metering_audit §6.1): any member; per-project breakdown for
  // owner/admin, aggregated totals otherwise.
  router.get('/:id/usage', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });

    const grain = req.query.grain === 'day' ? 'day' : 'hour';
    const metricsFilter = (req.query.metrics || '').split(',').map(s => s.trim()).filter(Boolean);
    const groupBy = canManageMembers(membership.role) && req.query.groupBy === 'project' ? 'project' : 'metric';
    const series = queryRollupSeries(db, {
      from: (req.query.from || '').trim(),
      to: (req.query.to || '').trim(),
      grain,
      metrics: metricsFilter,
      orgId,
      groupBy,
    });
    return res.json({ series, groupBy });
  });

  router.patch('/:id', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });

    const name = req.body?.name;
    const slug = req.body?.slug;
    const projectSlugPolicy = req.body?.projectSlugPolicy;
    if (name === undefined && slug === undefined && projectSlugPolicy === undefined) {
      return res.status(400).json({ error: 'name, slug, or projectSlugPolicy is required' });
    }

    const updates = {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'name is required' });
      updates.name = trimmed;
    }
    if (slug !== undefined) {
      const normalized = slugify(slug);
      if (!normalized) return res.status(400).json({ error: 'slug is required' });
      updates.slug = normalized;
    }
    if (projectSlugPolicy !== undefined) {
      if (projectSlugPolicy !== 'none' && projectSlugPolicy !== 'prefix') {
        return res.status(400).json({ error: "projectSlugPolicy must be 'none' or 'prefix'" });
      }
      updates.projectSlugPolicy = projectSlugPolicy;
    }

    const updated = updateOrganization(db, orgId, updates);
    return res.json({ organization: updated });
  });

  router.delete('/:id', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });
    deleteOrganization(db, orgId);
    return res.json({ deleted: true });
  });

  router.get('/:id/members', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const members = listOrganizationMembers(db, orgId);
    return res.json({ members });
  });

  router.post('/:id/members', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (!canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'viewer').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!ROLE_ORDER.includes(role)) return res.status(400).json({ error: 'role is invalid' });

    const targetUser = getUserByEmail(db, email);
    if (!targetUser) return res.status(404).json({ error: 'No account found with that email' });
    if (!targetUser.active) return res.status(400).json({ error: 'User account is not active' });

    const existing = getOrganizationMember(db, orgId, targetUser.id);
    if (existing) return res.status(409).json({ error: 'User is already a member of this team' });

    const createdMember = createOrganizationMember(db, {
      orgId,
      userId: targetUser.id,
      role,
      invitedBy: req.user.userId,
    });

    return res.status(201).json({ member: {
      ...createdMember,
      email: targetUser.email,
      name: targetUser.name,
    }});
  });

  router.patch('/:id/members/:userId', (req, res) => {
    const orgId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(orgId) || !Number.isFinite(targetUserId)) return res.status(400).json({ error: 'Invalid id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (!canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const role = String(req.body?.role || '').trim().toLowerCase();
    if (!ROLE_ORDER.includes(role)) return res.status(400).json({ error: 'role is invalid' });

    const target = getOrganizationMember(db, orgId, targetUserId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner' && membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });
    if (role === 'owner' && membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });

    const updated = updateOrganizationMemberRole(db, { orgId, userId: targetUserId, role });
    return res.json({ member: { userId: targetUserId, role: updated.role } });
  });

  router.delete('/:id/members/:userId', (req, res) => {
    const orgId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(orgId) || !Number.isFinite(targetUserId)) return res.status(400).json({ error: 'Invalid id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (req.user.userId !== targetUserId && !canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const target = getOrganizationMember(db, orgId, targetUserId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(403).json({ error: 'Cannot remove owner' });

    removeOrganizationMember(db, { orgId, userId: targetUserId });
    return res.json({ removed: true });
  });

  router.get('/:id/projects', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const projects = listOrganizationProjects(db, orgId);
    return res.json({ projects });
  });

  router.get('/:id/features', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const features = getOrganizationFeatureCodes(db, orgId);
    return res.json({ features });
  });

  router.put('/:id/features', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getOrgMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (!canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const requested = Array.isArray(req.body?.features) ? req.body.features : [];
    const features = setOrganizationFeatureCodes(db, {
      orgId,
      userId: req.user.userId,
      features: requested,
    });
    return res.json({ features });
  });

  return router;
}
