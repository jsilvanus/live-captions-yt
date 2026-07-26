import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  listBridgeSecurityRules, createBridgeSecurityRule, getBridgeSecurityRule, deleteBridgeSecurityRule,
} from '../db.js';
import { isValidHostPattern, isValidCommandPattern } from '../bridge-security.js';

const VALID_RULE_KINDS = ['ip', 'command'];
const VALID_RULE_TYPES = ['allow', 'deny'];

function validateRuleBody(body) {
  const { ruleKind, ruleType, pattern } = body || {};
  if (!VALID_RULE_KINDS.includes(ruleKind)) return `ruleKind must be one of: ${VALID_RULE_KINDS.join(', ')}`;
  if (!VALID_RULE_TYPES.includes(ruleType)) return `ruleType must be one of: ${VALID_RULE_TYPES.join(', ')}`;
  if (!pattern || typeof pattern !== 'string') return 'pattern is required';
  if (ruleKind === 'command' && !isValidCommandPattern(pattern)) return 'pattern is not a valid regular expression';
  if (ruleKind === 'ip' && !isValidHostPattern(pattern)) return 'pattern is not a valid host/IP/CIDR pattern';
  return null;
}

function serializeRule(row) {
  return {
    id:               row.id,
    bridgeInstanceId: row.bridge_instance_id,
    ruleKind:         row.rule_kind,
    ruleType:         row.rule_type,
    pattern:          row.pattern,
    description:      row.description,
    createdAt:        row.created_at,
  };
}

// Simple in-memory rate limiter: max 30 command requests per minute per IP
const _commandRateCounts = new Map(); // ip → { count, resetAt }
function commandRateLimit(req, res, next) {
  const ip  = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const now = Date.now();
  const entry = _commandRateCounts.get(ip);
  if (!entry || now >= entry.resetAt) {
    _commandRateCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  entry.count += 1;
  if (entry.count > 30) {
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }
  next();
}

// Routes that must stay unauthenticated even after opts.auth is supplied —
// these are hit by the bridge *agent* process, not a logged-in user, and
// already authenticate via bridgeManager.authenticate(token)/X-Bridge-Token
// (a bridge instance's own secret, unrelated to a user session). Mirrors
// routes/cameras.js's isUnauthenticatedCameraRoute() carve-out.
function isUnauthenticatedBridgeRoute(path) {
  return /^\/commands(\/|$)/.test(path)
    || /^\/status(\/|$)/.test(path)
    || /\/security-rules\/for-agent(\/|$)/.test(path);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('../bridge-manager.js').BridgeManager} bridgeManager
 * @param {string} [publicUrl]  Backend's public URL, used when generating .env files
 * @param {object} [opts]
 * @param {import('express').RequestHandler} [opts.auth]  Session/user/device
 *   auth middleware (createProjectAccessMiddleware), applied to every route
 *   except the bridge-agent-facing ones (see isUnauthenticatedBridgeRoute).
 *   Omit to keep this router's historical fully-open behavior (e.g. existing
 *   route-level tests that construct it directly).
 */
export function createBridgeRouter(db, bridgeManager, publicUrl = '', opts = {}) {
  const auth = opts.auth ?? null;
  const router = Router();

  if (auth) {
    router.use((req, res, next) => {
      if (isUnauthenticatedBridgeRoute(req.path)) return next();
      return auth(req, res, next);
    });
  }

  // ── SSE stream: bridge agent connects here ────────────────────────────────

  // GET /production/bridge/commands?token=xxx
  router.get('/commands', (req, res) => {
    const token = req.query.token;
    const instance = bridgeManager.authenticate(token);
    if (!instance) {
      return res.status(401).json({ error: 'Invalid bridge token' });
    }
    bridgeManager.connect(instance.id, res);
    // connect() takes over the response — do not call res.json() after this
  });

  // POST /production/bridge/status — bridge posts heartbeats and command results
  router.post('/status', (req, res) => {
    const token = req.headers['x-bridge-token'] ?? req.body?.token;
    const instance = bridgeManager.authenticate(token);
    if (!instance) {
      return res.status(401).json({ error: 'Invalid bridge token' });
    }
    bridgeManager.receiveStatus(instance.id, req.body ?? {});
    res.json({ ok: true });
  });

  // ── Bridge instance CRUD ──────────────────────────────────────────────────

  // GET /production/bridge/instances — list all bridge instances
  router.get('/instances', (_req, res) => {
    const rows = db.prepare('SELECT * FROM prod_bridge_instances ORDER BY created_at').all();
    res.json(rows.map(r => ({
      id:        r.id,
      name:      r.name,
      status:    bridgeManager.isConnected(r.id) ? 'connected' : 'disconnected',
      lastSeen:  r.last_seen,
      createdAt: r.created_at,
      // token is never returned in list
    })));
  });

  // POST /production/bridge/instances — create a bridge instance
  // Returns { id, name, envContent } where envContent is the pre-filled .env
  router.post('/instances', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    const id    = randomUUID();
    const token = randomBytes(32).toString('hex');
    db.prepare(`
      INSERT INTO prod_bridge_instances (id, name, token)
      VALUES (?, ?, ?)
    `).run(id, name.trim(), token);

    const envContent = buildEnvContent(token, publicUrl);
    res.status(201).json({ id, name: name.trim(), envContent });
  });

  // DELETE /production/bridge/instances/:id — delete a bridge instance
  router.delete('/instances/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_bridge_instances WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Bridge instance not found' });

    // Count cameras and mixers assigned to this bridge
    const camCount = db.prepare(
      'SELECT COUNT(*) AS n FROM prod_cameras WHERE bridge_instance_id = ?'
    ).get(id).n;
    const mixCount = db.prepare(
      'SELECT COUNT(*) AS n FROM prod_mixers WHERE bridge_instance_id = ?'
    ).get(id).n;

    if (!req.query.force && (camCount > 0 || mixCount > 0)) {
      return res.status(409).json({
        error: 'Bridge has assigned devices',
        cameras: camCount,
        mixers: mixCount,
        hint: 'Add ?force=1 to null out assignments and delete anyway',
      });
    }

    // Null out assignments
    db.prepare('UPDATE prod_cameras SET bridge_instance_id = NULL WHERE bridge_instance_id = ?').run(id);
    db.prepare('UPDATE prod_mixers  SET bridge_instance_id = NULL WHERE bridge_instance_id = ?').run(id);
    db.prepare('DELETE FROM prod_bridge_instances WHERE id = ?').run(id);

    bridgeManager.disconnect(id);
    res.status(204).end();
  });

  // POST /production/bridge/instances/:id/command — send a typed command to the bridge
  // Body: { type: 'tcp_send', host, port, payload }
  //     | { type: 'http_request', method?, url, headers?, body? }
  router.post('/instances/:id/command', commandRateLimit, async (req, res) => {
    const { id } = req.params;

    const { type, ...rest } = req.body ?? {};
    if (!type) return res.status(400).json({ error: 'type is required' });

    if (!bridgeManager.isConnected(id)) {
      return res.status(503).json({ error: 'Bridge is not connected' });
    }

    try {
      const result = await bridgeManager.sendCommand(id, { type, ...rest });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // GET /production/bridge/instances/:id/env — re-download the .env file
  router.get('/instances/:id/env', (req, res) => {
    const row = db.prepare('SELECT * FROM prod_bridge_instances WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Bridge instance not found' });

    const content = buildEnvContent(row.token, publicUrl);
    res.set({
      'Content-Type':        'text/plain',
      'Content-Disposition': `attachment; filename="lcyt-bridge-${row.name.replace(/\s+/g, '-')}.env"`,
    });
    res.send(content);
  });

  // ── Security rules: allow/deny lists for TCP commands and target IPs ─────

  // GET /production/bridge/instances/:id/security-rules/for-agent — the
  // bridge agent's own fetch of its policy, authenticated by bridge token
  // (not opts.auth — see isUnauthenticatedBridgeRoute). Deliberately resolves
  // the instance from the token itself, not req.params.id, so a token can
  // never be used to read another instance's rules by mismatched :id.
  router.get('/instances/:id/security-rules/for-agent', (req, res) => {
    const token = req.query.token ?? req.headers['x-bridge-token'];
    const instance = bridgeManager.authenticate(token);
    if (!instance) {
      return res.status(401).json({ error: 'Invalid bridge token' });
    }
    res.json({
      ipRules:      listBridgeSecurityRules(db, instance.id, 'ip').map(serializeRule),
      commandRules: listBridgeSecurityRules(db, instance.id, 'command').map(serializeRule),
    });
  });

  // GET /production/bridge/instances/:id/security-rules[?kind=ip|command]
  router.get('/instances/:id/security-rules', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM prod_bridge_instances WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Bridge instance not found' });

    const { kind } = req.query;
    if (kind && !VALID_RULE_KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${VALID_RULE_KINDS.join(', ')}` });
    }
    res.json({ rules: listBridgeSecurityRules(db, id, kind || null).map(serializeRule) });
  });

  // POST /production/bridge/instances/:id/security-rules
  // Body: { ruleKind: 'ip'|'command', ruleType: 'allow'|'deny', pattern, description? }
  router.post('/instances/:id/security-rules', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM prod_bridge_instances WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Bridge instance not found' });

    const error = validateRuleBody(req.body);
    if (error) return res.status(400).json({ error });

    const { ruleKind, ruleType, pattern, description } = req.body;
    const row = createBridgeSecurityRule(db, {
      id: randomUUID(), bridgeInstanceId: id, ruleKind, ruleType, pattern, description: description ?? null,
    });
    bridgeManager.broadcastRulesUpdated(id);
    res.status(201).json({ rule: serializeRule(row) });
  });

  // DELETE /production/bridge/instances/:id/security-rules/:ruleId
  router.delete('/instances/:id/security-rules/:ruleId', (req, res) => {
    const { id, ruleId } = req.params;
    const rule = getBridgeSecurityRule(db, ruleId);
    if (!rule || rule.bridge_instance_id !== id) return res.status(404).json({ error: 'Unknown rule' });

    deleteBridgeSecurityRule(db, ruleId);
    bridgeManager.broadcastRulesUpdated(id);
    res.json({ ok: true });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEnvContent(token, publicUrl) {
  const backendUrl = publicUrl || 'https://api.lcyt.fi';
  return [
    '# lcyt-bridge configuration',
    '# Place this file next to lcyt-bridge.exe and start the app.',
    '# Keep this file private — it contains your bridge authentication token.',
    '',
    `BACKEND_URL=${backendUrl}`,
    `BRIDGE_TOKEN=${token}`,
  ].join('\n') + '\n';
}
