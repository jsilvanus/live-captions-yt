import { writeAuditLog } from '../db/audit-log.js';

const REDACT_KEYS = new Set(['password', 'pin', 'token', 'secret', 'key', 'apikey', 'credentials', 'auth_config', 'authorization']);
const SKIP_PATH_PREFIXES = ['/captions', '/sync', '/mic', '/live', '/variables/refresh', '/dsk-rtmp', '/production/bridge/status'];

function sanitizeValue(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (depth >= 2) return `[${value.length}]`;
    return value.slice(0, 5).map(item => sanitizeValue(item, depth + 1));
  }
  if (depth >= 2) return '[object]';
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = '***';
      continue;
    }
    out[k] = sanitizeValue(v, depth + 1);
  }
  return out;
}

function summarizeBody(body) {
  if (body == null) return null;
  const sanitized = sanitizeValue(body);
  const text = JSON.stringify(sanitized);
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

function shouldSkip(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  const requestPath = `${req.baseUrl}${req.path}`;
  if (req.method === 'POST' && requestPath.startsWith('/captions')) return true;
  return SKIP_PATH_PREFIXES.some(prefix => requestPath.startsWith(prefix));
}

function resolveActor(req) {
  if (req.adminUser) return `user:${req.adminUser.email || req.adminUser.id || 'admin'}`;
  if (req.user?.email) return `user:${req.user.email}`;
  if (req.auth?.kind) return `${req.auth.kind}:${req.auth.projectId || req.auth.tokenId || 'unknown'}`;
  return 'session';
}

function resolveActorKind(req) {
  if (req.adminUser) return 'admin';
  if (req.auth?.kind === 'device') return 'device';
  if (req.auth?.kind === 'external') return 'external';
  if (req.auth?.kind === 'session') return 'session';
  if (req.user?.userId != null) return 'user';
  return 'session';
}

function resolveTargetType(req) {
  const [first] = (req.path || '').split('/').filter(Boolean);
  return first || null;
}

function resolveTargetId(req) {
  const values = Object.values(req.params || {});
  return values.find(value => typeof value === 'string' && value.trim()) || null;
}

function resolveIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

export function createWriteAuditMiddleware(db) {
  return function writeAuditMiddleware(req, res, next) {
    if (shouldSkip(req)) return next();

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      if (!req.auth && !req.user && !req.adminUser) return;

      const actionPath = req.route?.path || req.path || '/';
      const action = `${req.method} ${req.baseUrl}${actionPath}`.replace(/\/+/g, '/');
      const details = summarizeBody(req.body);
      writeAuditLog(db, {
        actor: resolveActor(req),
        actorKind: resolveActorKind(req),
        actorId: req.auth?.tokenId || req.user?.email || req.adminUser?.email || null,
        userId: req.user?.userId ?? null,
        apiKey: req.session?.apiKey || req.auth?.projectId || req.project?.projectId || null,
        orgId: req.auth?.orgId ?? null,
        action,
        targetType: resolveTargetType(req),
        targetId: resolveTargetId(req),
        details,
        ip: resolveIp(req),
      });
    });

    next();
  };
}
