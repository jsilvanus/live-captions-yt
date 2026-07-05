/**
 * Variable CRUD + SSE + refresh routes.
 *
 * Routes:
 *   GET    /variables                — snapshot: { [name]: { value, source, defaultValue, resolvedAt } }
 *   GET    /variables/events         — SSE: variable_updated { name, value, source, resolvedAt }
 *   POST   /variables                — create a manual variable
 *   PUT    /variables/:name          — update a manual variable's value/default
 *   DELETE /variables/:name          — remove a manual variable
 *   POST   /variables/refresh        — { connectorSlug, requestSlug, waitMs? }
 */
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { listVariables, getVariable, upsertManualVariable, deleteVariable, resolveVariableValue } from '../db.js';

function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Verify a session JWT and extract its apiKey. Unlike a raw base64 decode of
 * the payload segment, this actually checks the signature — an unverified
 * decode would let anyone hand-craft a token claiming any apiKey and
 * subscribe to that project's variable_updated stream.
 */
function verifyApiKeyFromToken(token, jwtSecret) {
  try {
    const payload = jwt.verify(token, jwtSecret);
    return payload.apiKey || null;
  } catch {
    return null;
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../variables-bus.js').VariablesBus} bus
 * @param {ReturnType<import('../resolution-engine.js').createResolutionEngine>} engine
 * @param {string} jwtSecret — for verifying the SSE ?token= / Bearer session JWT
 */
export function createVariablesRouter(db, auth, bus, engine, jwtSecret) {
  const router = Router();

  function requireApiKey(req, res) {
    const apiKey = req.session?.apiKey;
    if (!apiKey) {
      res.status(401).json({ error: 'Not authenticated' });
      return null;
    }
    return apiKey;
  }

  router.get('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const rows = listVariables(db, apiKey);
    const snapshot = {};
    for (const row of rows) {
      snapshot[row.name] = {
        value: resolveVariableValue(row),
        source: row.source,
        defaultValue: row.default_value,
        resolvedAt: row.resolved_at,
      };
    }
    res.json({ variables: snapshot });
  });

  // GET /variables/events (SSE) — EventSource can't set headers, so accept ?token= or Bearer.
  router.get('/events', (req, res) => {
    let apiKey;
    const tokenParam = req.query.token;
    if (tokenParam) {
      apiKey = verifyApiKeyFromToken(tokenParam, jwtSecret);
    } else {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Bearer token' });
      apiKey = verifyApiKeyFromToken(authHeader.slice(7), jwtSecret);
    }
    if (!apiKey) return res.status(401).json({ error: 'Invalid or expired token' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sendEvent(res, 'connected', { apiKey });
    bus.addSubscriber(apiKey, res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      bus.removeSubscriber(apiKey, res);
    });
  });

  router.post('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { name, value, defaultValue } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (name.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    if (getVariable(db, apiKey, name)) return res.status(409).json({ error: `Variable already exists: ${name}` });

    const row = upsertManualVariable(db, apiKey, name, { value, defaultValue });
    bus.emitVariableUpdated(apiKey, { name, value: resolveVariableValue(row), source: row.source, resolvedAt: row.resolved_at });
    res.status(201).json({ variable: { name, value: resolveVariableValue(row), source: row.source, defaultValue: row.default_value, resolvedAt: row.resolved_at } });
  });

  router.put('/:name', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { name } = req.params;
    if (name.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    const { value, defaultValue } = req.body || {};
    const row = upsertManualVariable(db, apiKey, name, { value, defaultValue });
    bus.emitVariableUpdated(apiKey, { name, value: resolveVariableValue(row), source: row.source, resolvedAt: row.resolved_at });
    res.json({ variable: { name, value: resolveVariableValue(row), source: row.source, defaultValue: row.default_value, resolvedAt: row.resolved_at } });
  });

  router.delete('/:name', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    deleteVariable(db, apiKey, req.params.name);
    res.json({ ok: true });
  });

  router.post('/refresh', auth, async (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { connectorSlug, requestSlug, waitMs } = req.body || {};
    if (!connectorSlug || !requestSlug) return res.status(400).json({ error: 'connectorSlug and requestSlug are required' });

    const firePromise = engine.fireRequest(apiKey, connectorSlug, requestSlug);

    if (!waitMs) {
      firePromise.catch(() => {});
      return res.status(202).json({ ok: true, pending: true });
    }

    const timeoutMs = Math.min(250, Math.max(150, Number(waitMs) || 200));
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const result = await Promise.race([firePromise.then((r) => ({ ...r, timedOut: false })), timeout]);
    clearTimeout(timer);

    if (result.timedOut) {
      firePromise.catch(() => {});
      return res.status(202).json({ ok: true, pending: true });
    }
    return res.status(200).json({ ok: result.ok, variables: result.variables, error: result.error });
  });

  return router;
}
