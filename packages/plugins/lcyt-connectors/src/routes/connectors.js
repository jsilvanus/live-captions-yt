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
 *
 * auth_config is never returned to the client — see maskConnector() in db.js.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  listConnectors, getConnectorBySlug, createConnector, updateConnector, deleteConnector, maskConnector,
  listRequests, getRequestBySlug, createRequest, updateRequest, deleteRequest,
  listMappings, getMappingById, createMapping, updateMapping, deleteMapping,
} from '../db.js';

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
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 */
export function createConnectorsRouter(db, auth) {
  const router = Router();
  router.use(auth);

  function requireApiKey(req, res) {
    const apiKey = req.session?.apiKey;
    if (!apiKey) {
      res.status(401).json({ error: 'Not authenticated' });
      return null;
    }
    return apiKey;
  }

  function requireConnector(req, res, apiKey) {
    const connector = getConnectorBySlug(db, apiKey, req.params.connectorSlug);
    if (!connector) {
      res.status(404).json({ error: `Unknown connector: ${req.params.connectorSlug}` });
      return null;
    }
    return connector;
  }

  function requireRequest(req, res, connector) {
    const request = getRequestBySlug(db, connector.id, req.params.requestSlug);
    if (!request) {
      res.status(404).json({ error: `Unknown request: ${req.params.requestSlug}` });
      return null;
    }
    return request;
  }

  // ── Connectors ────────────────────────────────────────────────────────────

  router.get('/', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    res.json({ connectors: listConnectors(db, apiKey).map(maskConnector) });
  });

  router.post('/', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const { name, slug, baseUrl, authType, authConfig, headers } = req.body || {};
    if (!name || !slug || !baseUrl) return res.status(400).json({ error: 'name, slug, and baseUrl are required' });
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    if (authType !== undefined && !VALID_AUTH_TYPES.includes(authType)) {
      return res.status(400).json({ error: `authType must be one of: ${VALID_AUTH_TYPES.join(', ')}` });
    }
    if (getConnectorBySlug(db, apiKey, slug)) return res.status(409).json({ error: `Connector slug already in use: ${slug}` });

    const row = createConnector(db, apiKey, { id: randomUUID(), name, slug, baseUrl, authType, authConfig, headers });
    res.status(201).json({ connector: maskConnector(row) });
  });

  router.get('/:connectorSlug', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    res.json({ connector: maskConnector(connector) });
  });

  router.put('/:connectorSlug', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const { name, slug, baseUrl, authType, authConfig, headers } = req.body || {};
    if (slug !== undefined && !SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    if (authType !== undefined && !VALID_AUTH_TYPES.includes(authType)) {
      return res.status(400).json({ error: `authType must be one of: ${VALID_AUTH_TYPES.join(', ')}` });
    }
    const row = updateConnector(db, connector.id, { name, slug, baseUrl, authType, authConfig, headers });
    res.json({ connector: maskConnector(row) });
  });

  router.delete('/:connectorSlug', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    deleteConnector(db, connector.id);
    res.json({ ok: true });
  });

  // ── Requests ─────────────────────────────────────────────────────────────

  router.get('/:connectorSlug/requests', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    res.json({ requests: listRequests(db, connector.id).map(maskRequest) });
  });

  router.post('/:connectorSlug/requests', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const { name, slug, method, path, queryParams, bodyType, bodyContent, responseType, prefetchIntervalMs, timeoutMs } = req.body || {};
    if (!name || !slug || !method || !path) return res.status(400).json({ error: 'name, slug, method, and path are required' });
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    if (!VALID_METHODS.includes(method)) return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    if (responseType !== undefined && !VALID_RESPONSE_TYPES.includes(responseType)) {
      return res.status(400).json({ error: `responseType must be one of: ${VALID_RESPONSE_TYPES.join(', ')}` });
    }
    if (getRequestBySlug(db, connector.id, slug)) return res.status(409).json({ error: `Request slug already in use: ${slug}` });

    const row = createRequest(db, connector.id, {
      id: randomUUID(), name, slug, method, path, queryParams, bodyType, bodyContent,
      responseType, prefetchIntervalMs, timeoutMs,
    });
    res.status(201).json({ request: maskRequest(row) });
  });

  router.get('/:connectorSlug/requests/:requestSlug', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const request = requireRequest(req, res, connector);
    if (!request) return;
    res.json({ request: maskRequest(request) });
  });

  router.put('/:connectorSlug/requests/:requestSlug', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const request = requireRequest(req, res, connector);
    if (!request) return;
    const { method, responseType, slug } = req.body || {};
    if (method !== undefined && !VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    }
    if (responseType !== undefined && !VALID_RESPONSE_TYPES.includes(responseType)) {
      return res.status(400).json({ error: `responseType must be one of: ${VALID_RESPONSE_TYPES.join(', ')}` });
    }
    if (slug !== undefined && !SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug must be lowercase, hyphen-separated' });
    const row = updateRequest(db, request.id, req.body || {});
    res.json({ request: maskRequest(row) });
  });

  router.delete('/:connectorSlug/requests/:requestSlug', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const request = requireRequest(req, res, connector);
    if (!request) return;
    deleteRequest(db, request.id);
    res.json({ ok: true });
  });

  // ── Response mappings ────────────────────────────────────────────────────

  router.get('/:connectorSlug/requests/:requestSlug/mappings', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const request = requireRequest(req, res, connector);
    if (!request) return;
    res.json({ mappings: listMappings(db, request.id).map(maskMapping) });
  });

  router.post('/:connectorSlug/requests/:requestSlug/mappings', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const request = requireRequest(req, res, connector);
    if (!request) return;
    const { jsonPath, variableName, skipIfNull, sortOrder } = req.body || {};
    if (!variableName) return res.status(400).json({ error: 'variableName is required' });
    if (variableName.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    const row = createMapping(db, request.id, { id: randomUUID(), jsonPath, variableName, skipIfNull, sortOrder });
    res.status(201).json({ mapping: maskMapping(row) });
  });

  router.put('/:connectorSlug/requests/:requestSlug/mappings/:mappingId', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const request = requireRequest(req, res, connector);
    if (!request) return;
    const existing = getMappingById(db, req.params.mappingId);
    if (!existing || existing.request_id !== request.id) return res.status(404).json({ error: 'Unknown mapping' });
    if (req.body?.variableName?.startsWith('_')) return res.status(400).json({ error: 'variable names starting with "_" are reserved' });
    const row = updateMapping(db, existing.id, req.body || {});
    res.json({ mapping: maskMapping(row) });
  });

  router.delete('/:connectorSlug/requests/:requestSlug/mappings/:mappingId', (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const connector = requireConnector(req, res, apiKey);
    if (!connector) return;
    const request = requireRequest(req, res, connector);
    if (!request) return;
    const existing = getMappingById(db, req.params.mappingId);
    if (!existing || existing.request_id !== request.id) return res.status(404).json({ error: 'Unknown mapping' });
    deleteMapping(db, existing.id);
    res.json({ ok: true });
  });

  return router;
}
