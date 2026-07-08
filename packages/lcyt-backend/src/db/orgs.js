import {
  clearOrgFeatureOverride,
  KNOWN_FEATURE_CODES,
  setOrgFeatureOverride,
  getOrgFeatureOverrides,
} from './project-features.js';

export function getOrgMembership(db, orgId, userId) {
  return db.prepare(`
    SELECT om.role, om.invited_by, om.joined_at, o.owner_user_id
    FROM org_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.org_id = ? AND om.user_id = ?
  `).get(orgId, userId) || null;
}

export function slugExists(db, slug) {
  return db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug);
}

export function buildUniqueSlug(db, base) {
  const slugBase = String(base || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'team';
  let slug = slugBase;
  let counter = 2;
  while (slugExists(db, slug)) {
    slug = `${slugBase}-${counter}`;
    counter += 1;
  }
  return slug;
}

export function listOrganizationsForUser(db, userId) {
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

export function getOrganizationDetails(db, orgId) {
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

export function createOrganization(db, { name, slug, ownerUserId }) {
  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO organizations (name, slug, owner_user_id)
      VALUES (?, ?, ?)
    `).run(name, slug, ownerUserId);
    const orgId = result.lastInsertRowid;
    db.prepare(`
      INSERT INTO org_members (org_id, user_id, role, invited_by)
      VALUES (?, ?, ?, ?)
    `).run(orgId, ownerUserId, 'owner', ownerUserId);
    return { id: orgId, name, slug };
  })();
}

export function updateOrganization(db, orgId, updates) {
  const fields = [];
  const params = [];
  if ('name' in updates) {
    fields.push('name = ?');
    params.push(updates.name);
  }
  if ('slug' in updates) {
    fields.push('slug = ?');
    params.push(updates.slug);
  }
  if (fields.length === 0) return null;
  params.push(orgId);
  db.prepare(`UPDATE organizations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare('SELECT id, name, slug, owner_user_id, created_at FROM organizations WHERE id = ?').get(orgId);
}

export function deleteOrganization(db, orgId) {
  return db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId).changes > 0;
}

export function listOrganizationMembers(db, orgId) {
  const rows = db.prepare(`
    SELECT om.id, om.user_id, om.role, om.invited_by, om.joined_at,
           u.email, u.name
    FROM org_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ?
    ORDER BY om.joined_at ASC
  `).all(orgId);

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    invitedBy: row.invited_by,
    joinedAt: row.joined_at,
    projectCount: db.prepare('SELECT COUNT(*) as n FROM api_keys WHERE org_id = ?').get(orgId).n,
  }));
}

export function getOrganizationMember(db, orgId, userId) {
  return db.prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?').get(orgId, userId) || null;
}

export function createOrganizationMember(db, { orgId, userId, role, invitedBy }) {
  const result = db.prepare(`
    INSERT INTO org_members (org_id, user_id, role, invited_by)
    VALUES (?, ?, ?, ?)
  `).run(orgId, userId, role, invitedBy);
  return {
    id: result.lastInsertRowid,
    userId,
    role,
    invitedBy,
    joinedAt: new Date().toISOString(),
  };
}

export function updateOrganizationMemberRole(db, { orgId, userId, role }) {
  db.prepare('UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?').run(role, orgId, userId);
  return { userId, role };
}

export function removeOrganizationMember(db, { orgId, userId }) {
  db.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(orgId, userId);
}

export function listOrganizationProjects(db, orgId) {
  const rows = db.prepare(`
    SELECT key, owner, created_at, active, email, user_id, org_id
    FROM api_keys
    WHERE org_id = ?
    ORDER BY created_at DESC
  `).all(orgId);

  return rows.map(project => ({
    key: project.key,
    owner: project.owner,
    createdAt: project.created_at,
    active: project.active === 1,
    email: project.email,
    userId: project.user_id,
    orgId: project.org_id,
  }));
}

export function getOrganizationFeatureCodes(db, orgId) {
  return getOrgFeatureOverrides(db, orgId)
    .filter(row => row.mode === 'available')
    .map(row => row.feature_code);
}

export function setOrganizationFeatureCodes(db, { orgId, userId, features }) {
  const requested = Array.isArray(features) ? features : [];
  const normalized = requested.filter(code => typeof code === 'string' && KNOWN_FEATURE_CODES.has(code));
  const existing = new Set(getOrgFeatureOverrides(db, orgId).map(row => row.feature_code));

  db.transaction(() => {
    for (const code of existing) {
      if (!normalized.includes(code)) clearOrgFeatureOverride(db, orgId, code);
    }
    for (const code of normalized) {
      setOrgFeatureOverride(db, orgId, code, 'available', userId);
    }
  })();

  return getOrganizationFeatureCodes(db, orgId);
}
