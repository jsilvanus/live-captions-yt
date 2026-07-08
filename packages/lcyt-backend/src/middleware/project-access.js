import jwt from 'jsonwebtoken';
import { getMemberAccessLevel } from '../db/project-members.js';
import { extractAuthToken, normalizeUserPayload } from './auth.js';

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
  if (projectRole === 'owner' || projectRole === 'admin' || projectRole === 'member') return projectRole;
  return 'member';
}

export function createProjectAccessMiddleware(db, jwtSecret) {
  return (req, res, next) => {
    const projectId = resolveProjectId(req);
    const token = extractAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      if (payload.type === 'user' || payload.kind === 'identity' || payload.kind === 'project') {
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

        req.user = { userId: user.userId, email: user.email, isAdmin: user.isAdmin, siteRole: user.siteRole };
        req.auth = {
          kind: payload.kind === 'project' ? 'project' : 'user',
          userId: user.userId,
          siteRole: user.siteRole,
          projectId: resolvedProjectId,
          projectRole: accessLevel,
          scopes: payload.scopes || null,
        };
        req.session = req.session || {};
        req.session.apiKey = resolvedProjectId;
        req.project = { projectId: resolvedProjectId, projectRole: accessLevel };
        return next();
      }

      if (payload.type === 'device' || payload.kind === 'device') {
        const resolvedProjectId = projectId || payload.projectId || payload.apiKey || null;
        if (!resolvedProjectId) {
          return res.status(400).json({ error: 'projectId is required' });
        }
        req.auth = {
          kind: 'device',
          projectId: resolvedProjectId,
          deviceRole: payload.deviceRole || payload.role || null,
          projectRole: payload.projectRole || null,
          userId: payload.userId || null,
          scopes: payload.scopes || null,
        };
        req.project = { projectId: resolvedProjectId, projectRole: payload.projectRole || 'member' };
        req.session = req.session || {};
        req.session.apiKey = resolvedProjectId;
        return next();
      }

      if (payload.sessionId && (payload.apiKey || payload.projectId)) {
        const resolvedProjectId = projectId || payload.projectId || payload.apiKey || null;
        if (!resolvedProjectId) {
          return res.status(400).json({ error: 'projectId is required' });
        }
        req.session = payload;
        req.auth = {
          kind: 'session',
          projectId: resolvedProjectId,
          sessionId: payload.sessionId,
        };
        req.project = { projectId: resolvedProjectId, projectRole: 'member' };
        return next();
      }

      return res.status(401).json({ error: 'Invalid token type' });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
