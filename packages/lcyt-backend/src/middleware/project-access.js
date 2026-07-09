import jwt from 'jsonwebtoken';
import { getMemberAccessLevel } from '../db/project-members.js';
import { verifyMcpToken, tokenHasScope } from '../db/mcp-tokens.js';
import { extractAuthToken, normalizeUserPayload, verifySessionToken } from './auth.js';

function resolveProjectId(req) {
  const explicit = req.headers['x-project-id'] || req.headers['x-api-key'];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  const routeCandidates = [
    req.params?.projectId,
    req.params?.project_id,
    req.params?.apiKey,
    req.params?.api_key,
    req.params?.key,
    req.params?.id,
  ];

  for (const candidate of routeCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  const bodyCandidates = [
    req.body?.projectId,
    req.body?.project_id,
    req.body?.apiKey,
    req.body?.api_key,
  ];

  for (const candidate of bodyCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  const queryCandidates = [
    req.query?.projectId,
    req.query?.project_id,
    req.query?.apiKey,
    req.query?.api_key,
  ];

  for (const candidate of queryCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return req.auth?.projectId || req.project?.projectId || null;
}

function normalizeProjectRole(projectRole) {
  if (projectRole === 'owner' || projectRole === 'admin' || projectRole === 'editor' || projectRole === 'operator' || projectRole === 'viewer') return projectRole;
  if (projectRole === 'member') return 'member';
  return 'member';
}

function attachProjectContext(req, authInfo) {
  req.user = req.user || {};
  req.auth = authInfo;
  req.project = { projectId: authInfo.projectId, projectRole: authInfo.projectRole || authInfo.deviceRole || 'member' };
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

/**
 * Create middleware for project-scoped access routes.
 *
 * Accepts session JWTs, user/project JWTs, device JWTs, or raw external tokens.
 * `requiredScope` can be used to gate external-token requests to a specific scope.
 */
export function createProjectAccessMiddleware(db, jwtSecret, { requiredScope = null } = {}) {
  return (req, res, next) => {
    const projectId = resolveProjectId(req);
    const token = extractAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    if (token.startsWith('lcytmcp_')) {
      const external = verifyMcpToken(db, token);
      if (!external) {
        return res.status(401).json({ error: 'Invalid or expired external token' });
      }
      const resolvedProjectId = projectId || external.projectId || external.apiKey || null;
      if (!resolvedProjectId) {
        return res.status(400).json({ error: 'projectId is required' });
      }
      if (requiredScope && !tokenHasScope(external.scopes, requiredScope)) {
        return res.status(403).json({ error: 'Insufficient token scope' });
      }
      attachProjectContext(req, {
        kind: 'external',
        projectId: resolvedProjectId,
        userId: external.userId,
        email: null,
        siteRole: null,
        projectRole: 'member',
        scopes: external.scopes,
        tokenId: external.id,
      });
      return next();
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      const sessionPayload = verifySessionToken(token, jwtSecret);
      if (sessionPayload && (sessionPayload.sessionId || sessionPayload.apiKey)) {
        const resolvedProjectId = projectId || sessionPayload.projectId || sessionPayload.apiKey || null;
        if (!resolvedProjectId) {
          return res.status(400).json({ error: 'projectId is required' });
        }
        attachProjectContext(req, {
          kind: 'session',
          projectId: resolvedProjectId,
          sessionId: sessionPayload.sessionId || null,
          projectRole: 'member',
          userId: null,
          email: null,
          siteRole: null,
        });
        return next();
      }

      if (payload.type === 'user' || payload.kind === 'identity' || payload.kind === 'user' || payload.kind === 'project') {
        const user = normalizeUserPayload(payload);
        if (!user.userId) {
          return res.status(401).json({ error: 'Invalid token payload' });
        }
        const resolvedProjectId = projectId || payload.projectId || payload.project || payload.apiKey || null;
        if (!resolvedProjectId) {
          return res.status(400).json({ error: 'projectId is required' });
        }
        const projectRole = payload.projectRole || payload.role || null;
        const accessLevel = projectRole ? normalizeProjectRole(projectRole) : getMemberAccessLevel(db, resolvedProjectId, user.userId);
        if (!accessLevel) {
          return res.status(403).json({ error: 'Not a project member' });
        }
        attachProjectContext(req, {
          kind: payload.kind === 'project' ? 'project' : 'user',
          userId: user.userId,
          email: user.email,
          siteRole: user.siteRole,
          projectId: resolvedProjectId,
          projectRole: accessLevel,
          scopes: payload.scopes || null,
        });
        return next();
      }

      if (payload.type === 'device' || payload.kind === 'device') {
        const resolvedProjectId = projectId || payload.projectId || payload.apiKey || null;
        if (!resolvedProjectId) {
          return res.status(400).json({ error: 'projectId is required' });
        }
        attachProjectContext(req, {
          kind: 'device',
          projectId: resolvedProjectId,
          deviceRole: payload.deviceRole || payload.role || null,
          projectRole: payload.projectRole || null,
          userId: payload.userId || null,
          email: payload.email || null,
          siteRole: payload.siteRole || null,
          scopes: payload.scopes || null,
        });
        return next();
      }

      return res.status(401).json({ error: 'Invalid token type' });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
