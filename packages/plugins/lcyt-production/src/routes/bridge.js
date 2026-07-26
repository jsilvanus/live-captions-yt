import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { requireTier } from '../route-access.js';

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

// Routes that must stay unauthenticated even after opts.auth is supplied:
// these are the bridge *agent's* own channel back to this backend (SSE
// command stream + heartbeat/status callback), authenticated by its own
// per-instance bridge token (bridgeManager.authenticate()) — a completely
// separate credential from a human session/user JWT. There is no req.user
// for the bridge binary to carry, so opts.auth (human project-access
// middleware) must never run on these two.
function isUnauthenticatedBridgeRoute(path) {
  return path === '/commands' || path === '/status';
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('../bridge-manager.js').BridgeManager} bridgeManager
 * @param {string} [publicUrl]  Backend's public URL, used when generating .env files
 * @param {{ auth?: import('express').RequestHandler, deps?: { checkProjectRole?: (tier: string, apiKey: string, userId: number) => boolean } }} [opts]
 *   `opts.auth` (real project-access middleware) was previously never wired
 *   into this router at all — instance CRUD + command dispatch were fully
 *   unauthenticated beyond the bridge-agent's own token auth on
 *   /commands|/status. Optional/opt-in, same pattern as cameras.js/mixers.js;
 *   server.js always supplies both `auth` and `deps` in production.
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

  // Setup-tier instance CRUD vs. Production-tier command dispatch
  // (plan_project_roles.md, decided 2026-07-26) — see route-access.js's doc
  // comment. GET /instances/:id/env (re-download the bridge's plaintext auth
  // token) is deliberately NOT gated here — it's a GET, and per this whole
  // system's own read/write split (requireTier / requireProjectRole both
  // exempt GET/HEAD/OPTIONS unconditionally), reads stay open to anyone who
  // already passed opts.auth. That is a real, separate credential-disclosure
  // gap this pass surfaced but does not fix — see CONSIDER.md.
  const requireSetup = requireTier(opts.deps ?? {}, 'setup');
  const requireProduction = requireTier(opts.deps ?? {}, 'production');

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
  router.post('/instances', requireSetup, (req, res) => {
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
  router.delete('/instances/:id', requireSetup, (req, res) => {
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
  router.post('/instances/:id/command', commandRateLimit, requireProduction, async (req, res) => {
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
