import jwt from 'jsonwebtoken';
import { getMemberAccessLevel } from '../db/project-members.js';
import { verifyMcpToken, tokenHasScope } from '../db/mcp-tokens.js';

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
  return validRoles.has(projectRole) ? projectRole : 'member';
}

function attachProjectContext(req, authInfo) {
  req.user = req.user || {};
  req.auth = authInfo;
  req.project = {
    projectId: authInfo.projectId,
    projectRole: authInfo.projectRole || authInfo.deviceRole || 'member',
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
      if (payload && (payload.sessionId || payload.apiKey)) {
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
        const accessLevel = projectRole ? normalizeProjectRole(projectRole) : getMemberAccessLevel(db, resolvedProjectId, user.userId);
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
