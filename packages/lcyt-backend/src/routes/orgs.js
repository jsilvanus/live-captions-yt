import { Router } from 'express';
import { getKey, updateKey } from '../db/keys.js';
import {
  clearOrgFeatureOverride,
  KNOWN_FEATURE_CODES,
  setOrgFeatureOverride,
  getOrgFeatureOverrides,
} from '../db/project-features.js';
import { getUserByEmail } from '../db/users.js';

const ROLE_ORDER = ['owner', 'admin', 'editor', 'operator', 'viewer'];

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'team';
}

function buildUniqueSlug(db, base) {
  const slugBase = slugify(base);
  let slug = slugBase;
  let counter = 2;
  while (db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug)) {
    slug = `${slugBase}-${counter}`;
    counter += 1;
  }
  return slug;
}

function canManageMembers(role) {
  return role === 'owner' || role === 'admin';
}

function getMembership(db, orgId, userId) {
  return db.prepare(`
    SELECT om.role, om.invited_by, om.joined_at, o.owner_user_id
    FROM org_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.org_id = ? AND om.user_id = ?
  `).get(orgId, userId) || null;
}

function getOrgRows(db, userId) {
  const rows = db.prepare(`
    SELECT o.id, o.name, o.slug, o.owner_user_id, o.created_at, om.role AS user_role
    FROM organizations o
    JOIN org_members om ON om.org_id = o.id
    WHERE om.user_id = ?
    ORDER BY o.created_at DESC
  `).all(userId);

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    role: row.user_role,
    memberCount: db.prepare('SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?').get(row.id).n,
    projectCount: db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE org_id = ?').get(row.id).n,
  }));
}

function getOrgDetails(db, orgId) {
  const org = db.prepare(`
    SELECT id, name, slug, owner_user_id, created_at
    FROM organizations
    WHERE id = ?
  `).get(orgId);
  if (!org) return null;

  const members = db.prepare(`
    SELECT om.id, om.org_id, om.user_id, om.role, om.invited_by, om.joined_at,
           u.email, u.name
    FROM org_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ?
    ORDER BY om.joined_at ASC
  `).all(orgId);

  const projects = db.prepare(`
    SELECT key, owner, created_at, active, email, user_id, org_id
    FROM api_keys
    WHERE org_id = ?
    ORDER BY created_at DESC
  `).all(orgId);

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    ownerUserId: org.owner_user_id,
    createdAt: org.created_at,
    members: members.map(member => ({
      id: member.id,
      userId: member.user_id,
      email: member.email,
      name: member.name,
      role: member.role,
      invitedBy: member.invited_by,
      joinedAt: member.joined_at,
    })),
    projects: projects.map(project => ({
      key: project.key,
      owner: project.owner,
      createdAt: project.created_at,
      active: project.active === 1,
      email: project.email,
      userId: project.user_id,
      orgId: project.org_id,
    })),
  };
}

export function createOrganizationsRouter(db, authMiddleware, { loginEnabled = false } = {}) {
  const router = Router();

  router.use((req, res, next) => {
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    authMiddleware(req, res, next);
  });

  router.get('/', (req, res) => {
    const rows = getOrgRows(db, req.user.userId);
    return res.json({ organizations: rows });
  });

  router.post('/', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const slug = buildUniqueSlug(db, name);
    const created = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO organizations (name, slug, owner_user_id)
        VALUES (?, ?, ?)
      `).run(name, slug, req.user.userId);
      const orgId = result.lastInsertRowid;
      db.prepare(`
        INSERT INTO org_members (org_id, user_id, role, invited_by)
        VALUES (?, ?, ?, ?)
      `).run(orgId, req.user.userId, 'owner', req.user.userId);
      return { id: orgId, name, slug };
    })();

    return res.status(201).json({ organization: created });
  });

  router.get('/:id', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const details = getOrgDetails(db, orgId);
    return res.json({ organization: details, role: membership.role });
  });

  router.patch('/:id', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });

    const name = req.body?.name;
    const slug = req.body?.slug;
    if (name === undefined && slug === undefined) return res.status(400).json({ error: 'name or slug is required' });

    const updates = [];
    const params = [];
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'name is required' });
      updates.push('name = ?');
      params.push(trimmed);
    }
    if (slug !== undefined) {
      const normalized = slugify(slug);
      if (!normalized) return res.status(400).json({ error: 'slug is required' });
      updates.push('slug = ?');
      params.push(normalized);
    }

    if (updates.length > 0) {
      params.push(orgId);
      db.prepare(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    const updated = db.prepare('SELECT id, name, slug, owner_user_id, created_at FROM organizations WHERE id = ?').get(orgId);
    return res.json({ organization: updated });
  });

  router.delete('/:id', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });
    db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);
    return res.json({ deleted: true });
  });

  router.get('/:id/members', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const rows = db.prepare(`
      SELECT om.id, om.user_id, om.role, om.invited_by, om.joined_at,
             u.email, u.name
      FROM org_members om
      JOIN users u ON u.id = om.user_id
      WHERE om.org_id = ?
      ORDER BY om.joined_at ASC
    `).all(orgId);
    return res.json({ members: rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      invitedBy: row.invited_by,
      joinedAt: row.joined_at,
    })) });
  });

  router.post('/:id/members', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (!canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'viewer').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!ROLE_ORDER.includes(role)) return res.status(400).json({ error: 'role is invalid' });

    const targetUser = getUserByEmail(db, email);
    if (!targetUser) return res.status(404).json({ error: 'No account found with that email' });
    if (!targetUser.active) return res.status(400).json({ error: 'User account is not active' });

    const existing = db.prepare('SELECT id FROM org_members WHERE org_id = ? AND user_id = ?').get(orgId, targetUser.id);
    if (existing) return res.status(409).json({ error: 'User is already a member of this team' });

    const result = db.prepare(`
      INSERT INTO org_members (org_id, user_id, role, invited_by)
      VALUES (?, ?, ?, ?)
    `).run(orgId, targetUser.id, role, req.user.userId);

    return res.status(201).json({ member: {
      id: result.lastInsertRowid,
      userId: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role,
      invitedBy: req.user.userId,
      joinedAt: new Date().toISOString(),
    }});
  });

  router.patch('/:id/members/:userId', (req, res) => {
    const orgId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(orgId) || !Number.isFinite(targetUserId)) return res.status(400).json({ error: 'Invalid id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (!canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const role = String(req.body?.role || '').trim().toLowerCase();
    if (!ROLE_ORDER.includes(role)) return res.status(400).json({ error: 'role is invalid' });

    const target = db.prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?').get(orgId, targetUserId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner' && membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });
    if (role === 'owner' && membership.role !== 'owner') return res.status(403).json({ error: 'owner role required' });

    db.prepare('UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?').run(role, orgId, targetUserId);
    return res.json({ member: { userId: targetUserId, role } });
  });

  router.delete('/:id/members/:userId', (req, res) => {
    const orgId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    if (!Number.isFinite(orgId) || !Number.isFinite(targetUserId)) return res.status(400).json({ error: 'Invalid id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (req.user.userId !== targetUserId && !canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const target = db.prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?').get(orgId, targetUserId);
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(403).json({ error: 'Cannot remove owner' });

    db.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(orgId, targetUserId);
    return res.json({ removed: true });
  });

  router.get('/:id/projects', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const projects = db.prepare(`
      SELECT key, owner, created_at, active, email, user_id, org_id
      FROM api_keys
      WHERE org_id = ?
      ORDER BY created_at DESC
    `).all(orgId);
    return res.json({ projects: projects.map(project => ({
      key: project.key,
      owner: project.owner,
      createdAt: project.created_at,
      active: project.active === 1,
      email: project.email,
      userId: project.user_id,
      orgId: project.org_id,
    })) });
  });

  router.get('/:id/features', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    const rows = getOrgFeatureOverrides(db, orgId);
    return res.json({ features: rows.filter(row => row.mode === 'available').map(row => row.feature_code) });
  });

  router.put('/:id/features', (req, res) => {
    const orgId = Number(req.params.id);
    if (!Number.isFinite(orgId)) return res.status(400).json({ error: 'Invalid org id' });
    const membership = getMembership(db, orgId, req.user.userId);
    if (!membership) return res.status(404).json({ error: 'Organization not found' });
    if (!canManageMembers(membership.role)) return res.status(403).json({ error: 'owner or admin required' });

    const requested = Array.isArray(req.body?.features) ? req.body.features : [];
    const features = requested.filter(code => typeof code === 'string' && KNOWN_FEATURE_CODES.has(code));
    const existing = new Set(getOrgFeatureOverrides(db, orgId).map(row => row.feature_code));

    db.transaction(() => {
      for (const code of existing) {
        if (!features.includes(code)) clearOrgFeatureOverride(db, orgId, code);
      }
      for (const code of features) {
        setOrgFeatureOverride(db, orgId, code, 'available', req.user.userId);
      }
    })();

    const rows = getOrgFeatureOverrides(db, orgId);
    return res.json({ features: rows.filter(row => row.mode === 'available').map(row => row.feature_code) });
  });

  return router;
}
