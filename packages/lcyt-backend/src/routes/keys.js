import { Router } from 'express';
import { getAllKeys, getKey, getKeyByEmail, createKey, revokeKey, deleteKey, updateKey, formatKey, deleteAllImages } from '../db.js';
import { provisionDefaultProjectFeatures, getEnabledFeatureSet } from '../db/project-features.js';
import { addMember, getMemberAccessLevel, getMemberCount, getAccessibleProjectsForUser } from '../db/project-members.js';
import { createAdminMiddleware } from '../middleware/admin.js';
import { extractAndVerifyUserToken } from '../middleware/user-auth.js';
import { hasProjectRole } from '../middleware/project-access.js';
import { purgeKeyFiles } from '../storage/purge-key-files.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Factory for the /keys router.
 *
 * Admin routes (all require X-Admin-Key header):
 *   GET    /keys         — List all API keys
 *   POST   /keys         — Create a new API key (accepts optional daily_limit, lifetime_limit)
 *   GET    /keys/:key    — Get details for a specific key
 *   PATCH  /keys/:key    — Update owner, expiration, or limits
 *   DELETE /keys/:key    — Revoke (soft-delete) or permanently delete
 *
 * User routes (when loginEnabled=true, require Bearer user token):
 *   GET    /keys         — List own API keys (projects)
 *   POST   /keys         — Create a new project key for the authenticated user
 *   PATCH  /keys/:key    — Rename own project (owner field only; project-creator only)
 *   PATCH  /keys/:key/visibility — Set team visibility (restricted) + org-baseline
 *                          ceiling (orgBaselineRole); explicit project admin/owner
 *                          or org-admin override, not project-creator-only
 *                          (plan_project_roles.md, decided 2026-07-26)
 *   DELETE /keys/:key    — Revoke own project key
 *
 * Public route (requires FREE_APIKEY_ACTIVE=1):
 *   POST   /keys?freetier — Self-service free-tier key sign-up (name + email required)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ loginEnabled?: boolean, jwtSecret?: string, settings?: import('../settings/service.js').SettingsService }} [opts]
 * @returns {Router}
 */
export function createKeysRouter(db, { loginEnabled = false, jwtSecret = null, settings = null, mediaStores = null, resolveStorage = null } = {}) {
  const router = Router();
  const adminMiddleware = createAdminMiddleware(db, jwtSecret);

  // POST /keys — Create API key (admin) OR user project OR free-tier sign-up (?freetier)
  router.post('/', async (req, res) => {
    // ── free-tier path ────────────────────────────────────────────────────────
    if ('freetier' in req.query) {
      const freeApikeyActive = settings ? settings.get('app.free_apikey_active') : process.env.FREE_APIKEY_ACTIVE === '1';
      if (!freeApikeyActive) {
        return res.status(404).json({ error: 'Not found' });
      }

      const { name, email } = req.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
        return res.status(400).json({ error: 'a valid email is required' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (await getKeyByEmail(db, normalizedEmail)) {
        return res.status(409).json({ error: 'A key already exists for this email' });
      }

      const expiresAt = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().replace('T', ' ').slice(0, 19);
      })();

      const newKey = await createKey(db, {
        owner: name.trim(),
        email: normalizedEmail,
        expiresAt,
        daily_limit: 200,
        lifetime_limit: 1000,
      });

      return res.status(201).json(formatKey(newKey));
    }

    // ── user path (loginEnabled + Bearer token, no X-Admin-Key) ──────────────
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return await _userCreateKey(db, jwtSecret, req, res);
    }

    // ── admin path ────────────────────────────────────────────────────────────
    return adminMiddleware(req, res, async () => {
      const { owner, key, expires, daily_limit, lifetime_limit, orgId } = req.body || {};

      if (!owner) {
        return res.status(400).json({ error: 'owner is required' });
      }

      let resolvedOrgId = null;
      if (orgId !== undefined && orgId !== null) {
        resolvedOrgId = Number(orgId);
        if (!Number.isFinite(resolvedOrgId)) {
          return res.status(400).json({ error: 'orgId must be a number' });
        }
      }

      const newKey = await createKey(db, {
        key,
        owner,
        expiresAt: expires || null,
        daily_limit: daily_limit ?? null,
        lifetime_limit: lifetime_limit ?? null,
        org_id: resolvedOrgId,
      });
      return res.status(201).json(formatKey(newKey));
    });
  });

  // GET /keys — List API keys (admin or user-scoped)
  router.get('/', async (req, res) => {
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return await _userListKeys(db, jwtSecret, req, res);
    }
    return adminMiddleware(req, res, async () => {
      const keys = await getAllKeys(db);
      return res.status(200).json({ keys: keys.map(formatKey) });
    });
  });

  // GET /keys/:key — Get details for a specific key (admin only)
  router.get('/:key', adminMiddleware, async (req, res) => {
    const row = await getKey(db, req.params.key);
    if (!row) {
      return res.status(404).json({ error: 'API key not found' });
    }
    return res.status(200).json(formatKey(row));
  });

  // PATCH /keys/:key — Update key (admin or user for own keys)
  router.patch('/:key', async (req, res) => {
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return await _userUpdateKey(db, jwtSecret, req, res);
    }
    return adminMiddleware(req, res, async () => {
      const existing = await getKey(db, req.params.key);
      if (!existing) {
        return res.status(404).json({ error: 'API key not found' });
      }

      const body = req.body || {};
      const updates = {};
      if (body.owner !== undefined) updates.owner = body.owner;
      if ('expires' in body) updates.expiresAt = body.expires || null;
      if ('daily_limit' in body) updates.daily_limit = body.daily_limit ?? null;
      if ('lifetime_limit' in body) updates.lifetime_limit = body.lifetime_limit ?? null;
      if ('backend_file_enabled' in body) updates.backend_file_enabled = !!body.backend_file_enabled;
      if ('relay_allowed' in body) updates.relay_allowed = !!body.relay_allowed;
      if ('radio_enabled' in body) updates.radio_enabled = !!body.radio_enabled;
      if ('hls_enabled' in body) updates.hls_enabled = !!body.hls_enabled;
      if ('cea708_delay_ms' in body) updates.cea708_delay_ms = body.cea708_delay_ms;
      if ('graphics_enabled' in body) updates.graphics_enabled = !!body.graphics_enabled;
      if ('embed_cors' in body) updates.embed_cors = body.embed_cors ?? '*';
      if ('orgId' in body) {
        if (body.orgId === null || body.orgId === undefined) {
          updates.org_id = null;
        } else {
          const parsedOrgId = Number(body.orgId);
          if (!Number.isFinite(parsedOrgId)) return res.status(400).json({ error: 'orgId must be a number' });
          updates.org_id = parsedOrgId;
        }
      }

      await updateKey(db, req.params.key, updates);

      const updated = await getKey(db, req.params.key);
      return res.status(200).json(formatKey(updated));
    });
  });

  // PATCH /keys/:key/visibility — set team visibility + org-baseline ceiling
  // (plan_project_roles.md, decided 2026-07-26). Setup-tier: requires explicit
  // project owner/admin OR an org owner/admin's unconditional override on a
  // team-visible project — deliberately broader than PATCH /keys/:key's own
  // project-creator-only gate above (which governs rename/org-move, not this).
  router.patch('/:key/visibility', async (req, res) => {
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = extractAndVerifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const existing = await getKey(db, req.params.key);
    if (!existing) return res.status(404).json({ error: 'API key not found' });
    if (!await hasProjectRole(db, 'setup', req.params.key, user.userId)) {
      return res.status(403).json({ error: 'Explicit project admin/owner access required' });
    }

    const { restricted, orgBaselineRole } = req.body || {};
    const updates = {};
    if (restricted !== undefined) updates.restricted = !!restricted;
    if (orgBaselineRole !== undefined) {
      if (!['viewer', 'editor'].includes(orgBaselineRole)) {
        return res.status(400).json({ error: 'orgBaselineRole must be viewer or editor' });
      }
      updates.org_baseline_role = orgBaselineRole;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'restricted and/or orgBaselineRole is required' });
    }

    await updateKey(db, req.params.key, updates);
    const updated = await getKey(db, req.params.key);
    return res.status(200).json(formatKey(updated));
  });

  // DELETE /keys/:key — Revoke or permanently delete (admin or user for own keys)
  router.delete('/:key', async (req, res) => {
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return await _userDeleteKey(db, jwtSecret, req, res);
    }
    return adminMiddleware(req, res, async () => {
      const existing = await getKey(db, req.params.key);
      if (!existing) {
        return res.status(404).json({ error: 'API key not found' });
      }

      if (req.query.permanent === 'true') {
        const imageRows = await deleteAllImages(db, req.params.key);
        // Files live in the local or S3 object stores; remove them before the rows naming them go.
        await purgeKeyFiles(db, req.params.key, { mediaStores, resolveStorage, imageRows });
        await deleteKey(db, req.params.key);
        return res.status(200).json({ key: req.params.key, deleted: true });
      } else {
        await revokeKey(db, req.params.key);
        return res.status(200).json({ key: req.params.key, revoked: true });
      }
    });
  });

  return router;
}

// ── User-scoped handlers ──────────────────────────────────────────────────────

async function _userListKeys(db, jwtSecret, req, res) {
  const user = extractAndVerifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  // plan_project_roles.md / CONSIDER.md: not just directly-owned projects —
  // also anything reachable via an explicit project_members row or the
  // org-baseline/org-admin-override resolver, each with its real effective
  // access level (not a blanket 'owner').
  const accessible = await getAccessibleProjectsForUser(db, user.userId);
  return res.status(200).json({
    keys: await Promise.all(accessible.map(async ({ row, myAccessLevel }) => {
      const base = formatKey(row);
      const features = [...await getEnabledFeatureSet(db, row.key)].sort();
      const memberCount = await getMemberCount(db, row.key);
      return { ...base, features, memberCount, myAccessLevel };
    })),
  });
}

async function _userCreateKey(db, jwtSecret, req, res) {
  const user = extractAndVerifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const { name, features: requestedFeatures, orgId } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  let resolvedOrgId = null;
  if (orgId !== undefined && orgId !== null) {
    resolvedOrgId = Number(orgId);
    if (!Number.isFinite(resolvedOrgId)) {
      return res.status(400).json({ error: 'orgId must be a number' });
    }
    const membership = await db.org_members.findFirst({ where: { org_id: resolvedOrgId, user_id: user.userId }, select: { role: true } });
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ error: 'owner or admin role required for this team' });
    }
  }

  const newKey = await createKey(db, {
    owner: name.trim(),
    user_id: user.userId,
    org_id: resolvedOrgId,
  });
  // Provision default features + any requested extras (validated against user entitlements)
  const extra = Array.isArray(requestedFeatures) ? requestedFeatures.filter(f => typeof f === 'string') : [];
  await provisionDefaultProjectFeatures(db, newKey.key, extra, resolvedOrgId);
  // Add creating user as owner
  await addMember(db, newKey.key, user.userId, 'owner');
  const features = [...await getEnabledFeatureSet(db, newKey.key)].sort();
  return res.status(201).json({ ...formatKey(newKey), features, memberCount: 1, myAccessLevel: 'owner', orgId: resolvedOrgId });
}

async function _userUpdateKey(db, jwtSecret, req, res) {
  const user = extractAndVerifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const existing = await getKey(db, req.params.key);
  if (!existing) return res.status(404).json({ error: 'API key not found' });
  if (existing.user_id !== user.userId) return res.status(403).json({ error: 'Forbidden' });
  const { name, orgId } = req.body || {};
  if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) {
    return res.status(400).json({ error: 'name is required' });
  }

  let resolvedOrgId = undefined;
  if (orgId !== undefined) {
    if (orgId === null) {
      resolvedOrgId = null;
    } else {
      resolvedOrgId = Number(orgId);
      if (!Number.isFinite(resolvedOrgId)) return res.status(400).json({ error: 'orgId must be a number' });
      const membership = await db.org_members.findFirst({ where: { org_id: resolvedOrgId, user_id: user.userId }, select: { role: true } });
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return res.status(403).json({ error: 'owner or admin role required for this team' });
      }
    }
  }

  await updateKey(db, req.params.key, { owner: name?.trim(), org_id: resolvedOrgId });
  const updated = await getKey(db, req.params.key);
  return res.status(200).json({ ...formatKey(updated), orgId: updated.org_id ?? null });
}

async function _userDeleteKey(db, jwtSecret, req, res) {
  const user = extractAndVerifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const existing = await getKey(db, req.params.key);
  if (!existing) return res.status(404).json({ error: 'API key not found' });
  if (existing.user_id !== user.userId) return res.status(403).json({ error: 'Forbidden' });
  await revokeKey(db, req.params.key);
  return res.status(200).json({ key: req.params.key, revoked: true });
}
