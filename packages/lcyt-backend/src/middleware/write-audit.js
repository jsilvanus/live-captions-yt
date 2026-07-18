import { writeAuditLog } from '../db/audit-log.js';

const REDACT_KEYS = new Set(['password', 'pin', 'token', 'secret', 'key', 'apikey', 'credentials', 'auth_config', 'authorization']);

// High-frequency or already-covered paths (plan_metering_audit §5.2). /admin
// is excluded because routes/admin.js writes richer semantic entries itself —
// auditing it here as well would duplicate every admin action.
const SKIP_PATTERNS = [
  /^\/captions(\/|$)/,
  /^\/sync(\/|$)/,
  /^\/mic(\/|$)/,
  /^\/live(\/|$)/,
  /^\/variables\/refresh(\/|$)/,
  /^\/dsk\/[^/]+\/broadcast(\/|$)/,
  /^\/events(\/|$)/,
  /^\/production\/bridge\/status(\/|$)/,
  /^\/dsk-rtmp(\/|$)/,
  /^\/roles\/[^/]+\/message(\/|$)/,
  /^\/admin(\/|$)/,
];

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
  return SKIP_PATTERNS.some(pattern => pattern.test(requestPath));
}

function resolveActor(req) {
  if (req.user?.email) return `user:${req.user.email}`;
  if (req.auth?.kind) return `${req.auth.kind}:${req.auth.projectId || req.auth.tokenId || 'unknown'}`;
  return 'session';
}

function resolveActorKind(req) {
  if (req.auth?.kind === 'device') return 'device';
  if (req.auth?.kind === 'external') return 'external';
  if (req.user?.userId != null || req.auth?.kind === 'user' || req.auth?.kind === 'project') return 'user';
  return 'session';
}

function resolveTargetType(req) {
  const [first] = (`${req.baseUrl}${req.path}` || '').split('/').filter(Boolean);
  return first || null;
}

function resolveTargetId(req) {
  const values = Object.values(req.params || {});
  return values.find(value => typeof value === 'string' && value.trim()) || null;
}

export function resolveIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

/**
 * Generic write-audit middleware (plan_metering_audit §5.2). Mounted once at
 * app level before the scoped routers; it only registers a finish listener,
 * and by finish time the router-level auth middlewares have populated
 * req.auth / req.user, so one mount covers every scoped router.
 */
export function createWriteAuditMiddleware(db) {
  return function writeAuditMiddleware(req, res, next) {
    if (shouldSkip(req)) return next();

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      if (!req.auth && !req.user) return;

      // Route template, not the concrete URL — bounded action-name cardinality.
      const actionPath = req.route?.path && req.route.path !== '/' ? req.route.path : req.path;
      const action = `${req.method} ${req.baseUrl}${actionPath === '/' ? '' : actionPath}`.replace(/\/+/g, '/');
      writeAuditLog(db, {
        actor: resolveActor(req),
        actorKind: resolveActorKind(req),
        actorId: req.user?.email || req.auth?.tokenId || null,
        userId: req.user?.userId ?? req.auth?.userId ?? null,
        apiKey: req.auth?.projectId || req.project?.projectId || req.session?.apiKey || null,
        orgId: req.auth?.orgId ?? null,
        action,
        targetType: resolveTargetType(req),
        targetId: resolveTargetId(req),
        details: summarizeBody(req.body),
        ip: resolveIp(req),
      });
    });

    next();
  };
}
