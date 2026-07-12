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
import {
  listVariables, getVariable, upsertManualVariable, deleteVariable,
  materializeExpired, serializeVariableRow,
} from '../db.js';
import { parseValueTtl } from '../ttl.js';
import { requireApiKey, extractSseToken, verifyApiKeyFromToken } from './helpers.js';

function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Resolve the effective { value, ttl } for a write. An inline `=>` annotation in
 * a string value (only when it parses to a valid TTL) wins; otherwise a
 * structured `ttl` body field is used; otherwise no TTL (which clears any pending
 * expiry — last-write-wins).
 */
function resolveWriteTtl(value, bodyTtl) {
  let effValue = value;
  let effTtl = bodyTtl && typeof bodyTtl === 'object' ? bodyTtl : null;
  if (typeof value === 'string' && value.includes('=>')) {
    const parsed = parseValueTtl(value);
    if (parsed.ttl) { effValue = parsed.value; effTtl = parsed.ttl; }
  }
  return { value: effValue, ttl: effTtl };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../variables-bus.js').VariablesBus} bus
 * @param {ReturnType<import('../resolution-engine.js').createResolutionEngine>} engine
 * @param {ReturnType<import('../ttl-scheduler.js').createTtlScheduler>} scheduler
 * @param {string} jwtSecret — for verifying the SSE ?token= / Bearer session JWT
 */
export function createVariablesRouter(db, auth, bus, engine, scheduler, jwtSecret) {
  const router = Router();

  router.get('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    // Lazily revert any TTLs due by now, and push each revert to SSE consumers.
    for (const row of materializeExpired(db, apiKey)) {
      bus.emitVariableUpdated(apiKey, serializeVariableRow(row));
    }
    const snapshot = {};
    for (const row of listVariables(db, apiKey)) {
      const { name, ...rest } = serializeVariableRow(row);
      snapshot[name] = rest;
    }
    res.json({ variables: snapshot });
  });

  // GET /variables/events (SSE) — EventSource can't set headers, so accept ?token= or Bearer.
  router.get('/events', (req, res) => {
    const apiKey = verifyApiKeyFromToken(extractSseToken(req), jwtSecret);
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
    const { name, value, defaultValue, ttl } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (name.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    if (getVariable(db, apiKey, name)) return res.status(409).json({ error: `Variable already exists: ${name}` });

    const w = resolveWriteTtl(value, ttl);
    const row = upsertManualVariable(db, apiKey, name, { value: w.value, defaultValue, ttl: w.ttl });
    scheduler.reschedule(apiKey, name);
    bus.emitVariableUpdated(apiKey, serializeVariableRow(row));
    res.status(201).json({ variable: serializeVariableRow(row) });
  });

  router.put('/:name', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { name } = req.params;
    if (name.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    const { value, defaultValue, ttl, source } = req.body || {};
    const w = resolveWriteTtl(value, ttl);
    const row = upsertManualVariable(db, apiKey, name, { value: w.value, defaultValue, ttl: w.ttl, source });
    scheduler.reschedule(apiKey, name);
    bus.emitVariableUpdated(apiKey, serializeVariableRow(row));
    res.json({ variable: serializeVariableRow(row) });
  });

  router.delete('/:name', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    scheduler.cancel(apiKey, req.params.name);
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
