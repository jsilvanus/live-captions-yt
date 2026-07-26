import jwt from 'jsonwebtoken';
import { getEffectiveProjectAccessLevel, PROJECT_ROLE_ORDER } from '../db/project-members.js';
import { verifyMcpToken, tokenHasScope } from '../db/mcp-tokens.js';
import { isDeviceRoleActive } from '../db/device-roles.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
import { extractAuthToken, normalizeUserPayload } from './auth.js';

function resolveProjectId(req) {
  const explicit = req.headers['x-project-id'] || req.headers['x-api-key'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  const candidates = [
    req.params?.projectId,
    req.params?.project_id,
    req.params?.apiKey,
    req.params?.api_key,
    req.params?.key,
    req.params?.id,
    req.body?.projectId,
    req.body?.project_id,
    req.body?.apiKey,
    req.body?.api_key,
    req.query?.projectId,
    req.query?.project_id,
    req.query?.apiKey,
    req.query?.api_key,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && (candidate = candidate.trim())) return candidate;
  }

  return req.auth?.projectId || req.project?.projectId || null;
}

function normalizeProjectRole(projectRole) {
  const validRoles = new Set(['owner', 'admin', 'editor', 'operator', 'viewer']);
  return validRoles.has(projectRole) ? projectRole : 'viewer';
}

function attachProjectContext(req, authInfo) {
  req.user = req.user || {};
  req.auth = authInfo;
  req.project = {
    projectId: authInfo.projectId,
    // Informational only — session/external/device token kinds don't carry a
    // real per-user project role, so this label is display-only. Anything
    // that needs to actually *gate* a write must call requireProjectRole()
    // (middleware/project-access.js), which recomputes from userId, not this.
    projectRole: authInfo.projectRole || authInfo.deviceRole || 'viewer',
    activeBroadcastId: authInfo.activeBroadcastId ?? null,
  };
  req.session = req.session || {};
  req.session.apiKey = authInfo.projectId;
  req.session.projectId = authInfo.projectId;
  if (authInfo.userId != null) {
    req.user.userId = authInfo.userId;
    req.user.email = authInfo.email;
    req.user.isAdmin = authInfo.isAdmin;
    req.user.siteRole = authInfo.siteRole;
  }
  return authInfo;
}

function handleTokenAuth(req, res, next, authInfo) {
  if (!authInfo.projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }
  attachProjectContext(req, authInfo);
  return next();
}

/**
 * Create middleware for project-scoped access routes.
 *
 * Accepts session JWTs, user/project JWTs, device JWTs, or raw external tokens.
 * `requiredScope` can be used to gate external-token requests to a specific scope.
 */
export function createProjectAccessMiddleware(db, jwtSecret, { requiredScope = null, jwtOnly = false } = {}) {
  return (req, res, next) => {
    const projectId = resolveProjectId(req);
    const token = extractAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    if (token.startsWith('lcytmcp_')) {
      // `jwtOnly` resources (e.g. /variables) are for browser/CLI members only;
      // external subscribers use /events/stream instead of the REST snapshot.
      if (jwtOnly) {
        return res.status(403).json({ error: 'External tokens are not permitted for this resource' });
      }
      const external = verifyMcpToken(db, token);
      if (!external) {
        return res.status(401).json({ error: 'Invalid or expired external token' });
      }
      if (requiredScope) {
        // `resource:verb` requiredScope (e.g. 'events:read') is matched exactly;
        // a bare resource (e.g. 'dsk') infers the verb from the HTTP method, so a
        // token needs `dsk:read` to GET and `dsk:write` to mutate. Empty/NULL
        // scopes = full delegation (tokenHasScope returns true).
        const needed = requiredScope.includes(':')
          ? requiredScope
          : `${requiredScope}:${READ_METHODS.has(req.method) ? 'read' : 'write'}`;
        if (!tokenHasScope(external.scopes, needed)) {
          return res.status(403).json({ error: 'Insufficient token scope' });
        }
      }
      return handleTokenAuth(req, res, next, {
        kind: 'external',
        projectId: projectId || external.projectId || external.apiKey,
        userId: external.userId,
        email: null,
        siteRole: null,
        projectRole: 'member',
        scopes: external.scopes,
        tokenId: external.id,
      });
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      // Legacy session tokens are plain { sessionId, apiKey } with no type/kind field.
      // Device tokens also carry apiKey (for projectId resolution) but declare an
      // explicit type/kind — they must fall through to the device branch below,
      // not be swallowed here (this previously made every device token resolve
      // as kind:'session', so deviceRole/roleId/permissions were never attached
      // and the Item 4 active-role check below never ran).
      const isDeviceToken = payload?.type === 'device' || payload?.kind === 'device';
      if (payload && !isDeviceToken && (payload.sessionId || payload.apiKey)) {
        return handleTokenAuth(req, res, next, {
          kind: 'session',
          projectId: projectId || payload.projectId || payload.apiKey,
          sessionId: payload.sessionId || null,
          projectRole: 'member',
          userId: null,
          email: null,
          siteRole: null,
        });
      }

      if (payload.type === 'user' || payload.kind === 'identity' || payload.kind === 'user' || payload.kind === 'project') {
        const user = normalizeUserPayload(payload);
        if (!user.userId) {
          return res.status(401).json({ error: 'Invalid token payload' });
        }
        const resolvedProjectId = projectId || payload.projectId || payload.project || payload.apiKey;
        if (!resolvedProjectId) {
          return res.status(400).json({ error: 'projectId is required' });
        }
        const projectRole = payload.projectRole || payload.role || null;
        const accessLevel = projectRole ? normalizeProjectRole(projectRole) : getEffectiveProjectAccessLevel(db, resolvedProjectId, user.userId);
        if (!accessLevel) {
          return res.status(403).json({ error: 'Not a project member' });
        }
        return handleTokenAuth(req, res, next, {
          kind: payload.kind === 'project' ? 'project' : 'user',
          userId: user.userId,
          email: user.email,
          siteRole: user.siteRole,
          projectId: resolvedProjectId,
          projectRole: accessLevel,
          scopes: payload.scopes || null,
          activeBroadcastId: payload.activeBroadcastId ?? null,
        });
      }

      if (payload.type === 'device' || payload.kind === 'device') {
        // Device JWTs carry a 1h TTL, but a deactivated/expired role must revoke
        // access immediately rather than waiting for the token to expire
        // (Item 4 — Phase 4, plan_userprojects.md). roleId is only present on
        // tokens issued after this check was added; older tokens without it
        // fall through unchecked until they naturally expire.
        if (payload.roleId != null && !isDeviceRoleActive(db, payload.roleId)) {
          return res.status(401).json({ error: 'Device role is inactive or expired' });
        }
        return handleTokenAuth(req, res, next, {
          kind: 'device',
          projectId: projectId || payload.projectId || payload.apiKey,
          deviceRole: payload.deviceRole || payload.role || null,
          projectRole: payload.projectRole || null,
          userId: payload.userId || null,
          email: payload.email || null,
          siteRole: payload.siteRole || null,
          scopes: payload.scopes || null,
          roleId: payload.roleId || null,
        });
      }

      return res.status(401).json({ error: 'Invalid token type' });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

/**
 * Page-scoped write-access tiers (plan_project_roles.md, decided 2026-07-26).
 * Each tier's minimum required effective project role, per PROJECT_ROLE_ORDER:
 *   - 'setup'      — admin+. Only explicit project_members owner/admin, or an
 *                    org owner/admin's unconditional override (both surface as
 *                    'admin'/'owner' from getEffectiveProjectAccessLevel() —
 *                    the org-baseline viewer/editor *ceiling* never reaches
 *                    'admin', so this tier can never be satisfied by an
 *                    ordinary org member, only by the two paths above).
 *   - 'assets'     — editor+.
 *   - 'production' — operator+.
 * Generalizes the 2026-07-20 interim fix's requireExplicitAdmin() pattern
 * (routes/mcp-tokens.js), which predates this tier system and checked
 * explicit owner/admin only via getMemberAccessLevel() (no org-admin
 * override) — that route is migrated to requireProjectRole('setup') as part
 * of this generalization.
 */
export const PROJECT_TIER_MIN_LEVEL = { setup: 'admin', assets: 'editor', production: 'operator' };

/**
 * Non-Express helper: does this user meet the given tier's minimum role on
 * this project? Recomputes from (apiKey, userId) via getEffectiveProjectAccessLevel()
 * rather than trusting any role value already attached to req — session/
 * external/device token kinds don't carry a real per-user resolved role (see
 * attachProjectContext's projectRole comment above), so only a fresh,
 * userId-keyed lookup is safe to gate a write on. Returns false (fail closed)
 * for any tier that isn't a real project_members-backed identity — session
 * tokens, external MCP tokens, and device tokens all resolve false here,
 * exactly like the interim fix's requireExplicitAdmin() did.
 * @param {import('better-sqlite3').Database} db
 * @param {'setup'|'assets'|'production'} tier
 * @param {string} apiKey
 * @param {number|null|undefined} userId
 * @returns {boolean}
 */
export function hasProjectRole(db, tier, apiKey, userId) {
  const minLevel = PROJECT_TIER_MIN_LEVEL[tier];
  if (!minLevel || !apiKey || !userId) return false;
  const level = getEffectiveProjectAccessLevel(db, apiKey, userId);
  if (!level) return false;
  return PROJECT_ROLE_ORDER[level] >= PROJECT_ROLE_ORDER[minLevel];
}

/**
 * Express middleware factory gating a route (or router) at one of the three
 * page-scoped tiers above. Mount after the broad scopedAuth()/
 * createProjectAccessMiddleware() gate — this is a *narrower* check on top of
 * it, not a replacement (a request that fails this still needs to have
 * passed the broader project-access gate first to reach here at all).
 * @param {import('better-sqlite3').Database} db
 * @param {'setup'|'assets'|'production'} tier
 * @returns {import('express').RequestHandler}
 */
export function requireProjectRole(db, tier) {
  const minLevel = PROJECT_TIER_MIN_LEVEL[tier];
  return (req, res, next) => {
    const apiKey = req.auth?.projectId || req.project?.projectId || resolveProjectId(req);
    // No resolvable project id is the route handler's own 400 to raise, not
    // this gate's 403 — let it through unchanged (matches requireExplicitAdmin).
    if (!apiKey) return next();
    const userId = req.user?.userId;
    if (!hasProjectRole(db, tier, apiKey, userId)) {
      return res.status(403).json({ error: `Explicit project ${minLevel}${minLevel === 'admin' ? '/owner' : '+'} access required` });
    }
    next();
  };
}
