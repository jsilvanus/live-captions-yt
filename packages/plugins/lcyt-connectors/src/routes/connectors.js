/**
 * API Connector / Request / Response-Mapping CRUD routes.
 *
 * Routes:
 *   GET/POST             /connectors
 *   GET/PUT/DELETE       /connectors/:connectorSlug
 *   GET/POST             /connectors/:connectorSlug/requests
 *   GET/PUT/DELETE       /connectors/:connectorSlug/requests/:requestSlug
 *   GET/POST             /connectors/:connectorSlug/requests/:requestSlug/mappings
 *   PUT/DELETE           /connectors/:connectorSlug/requests/:requestSlug/mappings/:mappingId
 *   PUT                  /connectors/:connectorSlug/requests/:requestSlug/poll
 *
 * auth_config is never returned to the client — see maskConnector() in db.js.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  listConnectors, getConnectorBySlug, createConnector, updateConnector, deleteConnector, maskConnector,
  listRequests, getRequestBySlug, createRequest, updateRequest, deleteRequest, setConstantPoll,
  listMappings, getMappingById, createMapping, updateMapping, deleteMapping,
} from '../db.js';
import { requireApiKey } from './helpers.js';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];
const VALID_AUTH_TYPES = ['none', 'api_key', 'bearer', 'basic', 'custom'];
const VALID_RESPONSE_TYPES = ['auto', 'json', 'text', 'image', 'binary', 'raw'];

function maskRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    method: row.method,
    path: row.path,
    queryParams: JSON.parse(row.query_params || '[]'),
    bodyType: row.body_type,
    bodyContent: row.body_content,
    responseType: row.response_type,
    prefetchIntervalMs: row.prefetch_interval_ms,
    timeoutMs: row.timeout_ms,
    constantPollEnabled: !!row.constant_poll_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function maskMapping(row) {
  if (!row) return null;
  return {
    id: row.id,
    jsonPath: row.json_path,
    variableName: row.variable_name,
    skipIfNull: !!row.skip_if_null,
    sortOrder: row.sort_order,
  };
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {import('express').RequestHandler} auth
 * @param {ReturnType<import('../poll-scheduler.js').createPollScheduler>} [pollScheduler] —
 *   omit to disable the constant-poll toggle route (PUT .../poll 501s without it)
 */
export function createConnectorsRouter(db, auth, pollScheduler = null) {
  const router = Router();
  router.use(auth);

  // Resolve the session's apiKey once per request; :connectorSlug/:requestSlug
  // params below resolve their row scoped to it and attach req.connector/req.request.
  router.use(async (req, res, next) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    req.apiKey = apiKey;
    next();
  });

  // router.param callbacks are not wrapped by the async-handler patch, so errors go to next() by hand.
  router.param('connectorSlug', async (req, res, next, slug) => {
    try {
      const connector = await getConnectorBySlug(db, req.apiKey, slug);
      if (!connector) return res.status(404).json({ error: `Unknown connector: ${slug}` });
      req.connector = connector;
      next();
    } catch (err) { next(err); }
  });

  router.param('requestSlug', async (req, res, next, slug) => {
    try {
      const request = await getRequestBySlug(db, req.connector.id, slug);
      if (!request) return res.status(404).json({ error: `Unknown request: ${slug}` });
      req.request = request;
      next();
    } catch (err) { next(err); }
  });

  // ── Connectors ────────────────────────────────────────────────────────────

  // Requests are joined in here (not a separate per-connector round trip) so
  // callers that need every request across every connector — e.g. the
  // Production workspace's connectorPolls widget — get it in one call instead
  // of GET /connectors followed by N GET /connectors/:slug/requests.
  router.get('/', async (req, res) => {
    const connectors = await Promise.all((await listConnectors(db, req.apiKey)).map(async (c) => ({
      ...maskConnector(c),
      requests: (await listRequests(db, c.id)).map(maskRequest),
    })));
    res.json({ connectors });
  });

  router.post('/', async (req, res) => {
    const { name, slug, baseUrl, authType, authConfig, headers } = req.body || {};
    if (!name || !slug || !baseUrl) return res.status(400).json({ error: 'name, slug, and baseUrl are required' });
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    if (authType !== undefined && !VALID_AUTH_TYPES.includes(authType)) {
      return res.status(400).json({ error: `authType must be one of: ${VALID_AUTH_TYPES.join(', ')}` });
    }
    if (await getConnectorBySlug(db, req.apiKey, slug)) return res.status(409).json({ error: `Connector slug already in use: ${slug}` });

    const row = await createConnector(db, req.apiKey, { id: randomUUID(), name, slug, baseUrl, authType, authConfig, headers });
    res.status(201).json({ connector: maskConnector(row) });
  });

  router.get('/:connectorSlug', async (req, res) => {
    res.json({ connector: maskConnector(req.connector) });
  });

  router.put('/:connectorSlug', async (req, res) => {
    const { name, slug, baseUrl, authType, authConfig, headers } = req.body || {};
    if (slug !== undefined && !SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    if (authType !== undefined && !VALID_AUTH_TYPES.includes(authType)) {
      return res.status(400).json({ error: `authType must be one of: ${VALID_AUTH_TYPES.join(', ')}` });
    }
    const row = await updateConnector(db, req.connector.id, { name, slug, baseUrl, authType, authConfig, headers });
    // No re-keying needed on a connector-slug rename: PollScheduler resolves
    // the current connector/request slugs from the DB by request id on every
    // fire, so a rename just takes effect on the next tick.
    res.json({ connector: maskConnector(row) });
  });

  router.delete('/:connectorSlug', async (req, res) => {
    if (pollScheduler) {
      for (const r of await listRequests(db, req.connector.id)) pollScheduler.stop(r.id);
    }
    await deleteConnector(db, req.connector.id);
    res.json({ ok: true });
  });

  // ── Requests ─────────────────────────────────────────────────────────────

  router.get('/:connectorSlug/requests', async (req, res) => {
    res.json({ requests: (await listRequests(db, req.connector.id)).map(maskRequest) });
  });

  router.post('/:connectorSlug/requests', async (req, res) => {
    const { name, slug, method, path, queryParams, bodyType, bodyContent, responseType, prefetchIntervalMs, timeoutMs } = req.body || {};
    if (!name || !slug || !method || !path) return res.status(400).json({ error: 'name, slug, method, and path are required' });
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    if (!VALID_METHODS.includes(method)) return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    if (responseType !== undefined && !VALID_RESPONSE_TYPES.includes(responseType)) {
      return res.status(400).json({ error: `responseType must be one of: ${VALID_RESPONSE_TYPES.join(', ')}` });
    }
    if (await getRequestBySlug(db, req.connector.id, slug)) return res.status(409).json({ error: `Request slug already in use: ${slug}` });

    const row = await createRequest(db, req.connector.id, {
      id: randomUUID(), name, slug, method, path, queryParams, bodyType, bodyContent,
      responseType, prefetchIntervalMs, timeoutMs,
    });
    res.status(201).json({ request: maskRequest(row) });
  });

  router.get('/:connectorSlug/requests/:requestSlug', async (req, res) => {
    res.json({ request: maskRequest(req.request) });
  });

  router.put('/:connectorSlug/requests/:requestSlug', async (req, res) => {
    const { method, responseType, slug } = req.body || {};
    if (method !== undefined && !VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    }
    if (responseType !== undefined && !VALID_RESPONSE_TYPES.includes(responseType)) {
      return res.status(400).json({ error: `responseType must be one of: ${VALID_RESPONSE_TYPES.join(', ')}` });
    }
    if (slug !== undefined && !SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    const priorIntervalMs = req.request.prefetch_interval_ms;
    const row = await updateRequest(db, req.request.id, req.body || {});
    // A slug rename needs no action — PollScheduler resolves the current
    // slug from the DB by request id on every fire. Only the interval needs
    // an explicit restart: a live setInterval's delay can't be changed in
    // place, and restarting unconditionally would fire one unplanned extra
    // live request on every unrelated field edit (name, body, timeout).
    if (pollScheduler && row.constant_poll_enabled && row.prefetch_interval_ms !== priorIntervalMs) {
      await pollScheduler.start(row.id, row.prefetch_interval_ms);
    }
    res.json({ request: maskRequest(row) });
  });

  router.delete('/:connectorSlug/requests/:requestSlug', async (req, res) => {
    await deleteRequest(db, req.request.id);
    if (pollScheduler) pollScheduler.stop(req.request.id);
    res.json({ ok: true });
  });

  // ── Constant poll — session-long, pointer-independent background refresh ──
  // Deliberately separate from !api:/api:/api!: (plan_live_variables.md §2):
  // an explicit per-request opt-in toggle, never implied by inline metacode.
  router.put('/:connectorSlug/requests/:requestSlug/poll', async (req, res) => {
    if (!pollScheduler) return res.status(501).json({ error: 'Constant poll is not enabled on this server' });
    const enabled = !!req.body?.enabled;
    const row = await setConstantPoll(db, req.request.id, enabled);
    if (enabled) await pollScheduler.start(row.id, row.prefetch_interval_ms);
    else pollScheduler.stop(row.id);
    res.json({ request: maskRequest(row) });
  });

  // ── Response mappings ────────────────────────────────────────────────────

  router.get('/:connectorSlug/requests/:requestSlug/mappings', async (req, res) => {
    res.json({ mappings: (await listMappings(db, req.request.id)).map(maskMapping) });
  });

  router.post('/:connectorSlug/requests/:requestSlug/mappings', async (req, res) => {
    const { jsonPath, variableName, skipIfNull, sortOrder } = req.body || {};
    if (!variableName) return res.status(400).json({ error: 'variableName is required' });
    if (variableName.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    const row = await createMapping(db, req.request.id, { id: randomUUID(), jsonPath, variableName, skipIfNull, sortOrder });
    res.status(201).json({ mapping: maskMapping(row) });
  });

  router.put('/:connectorSlug/requests/:requestSlug/mappings/:mappingId', async (req, res) => {
    const existing = await getMappingById(db, req.params.mappingId);
    if (!existing || existing.request_id !== req.request.id) return res.status(404).json({ error: 'Unknown mapping' });
    if (req.body?.variableName?.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    const row = await updateMapping(db, existing.id, req.body || {});
    res.json({ mapping: maskMapping(row) });
  });

  router.delete('/:connectorSlug/requests/:requestSlug/mappings/:mappingId', async (req, res) => {
    const existing = await getMappingById(db, req.params.mappingId);
    if (!existing || existing.request_id !== req.request.id) return res.status(404).json({ error: 'Unknown mapping' });
    await deleteMapping(db, existing.id);
    res.json({ ok: true });
  });

  return router;
}
