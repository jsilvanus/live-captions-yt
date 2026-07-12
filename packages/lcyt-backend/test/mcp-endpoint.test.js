/**
 * Tests for POST /mcp — the in-process MCP endpoint (Phase 1).
 * Covers: tool listing with scope filtering, tool execution, destructive tool
 * staging, rate limiting, and error handling.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { EventBus } from 'lcyt/event-bus';
import { initDb, createKey } from '../src/db.js';
import { createMcpToken } from '../src/db/mcp-tokens.js';
import { createProjectAccessMiddleware } from '../src/middleware/project-access.js';
import { createMcpEndpointRouter, deriveToolScope } from '../src/routes/mcp-endpoint.js';

const JWT_SECRET = 'test-mcp-endpoint-secret';

// Minimal tool registry stub
function createStubRegistry() {
  const tools = [
    { name: 'camera.list', description: 'List cameras', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true }, handler: () => ({ ok: true, cameras: [] }) },
    { name: 'camera.preset', description: 'Trigger preset', inputSchema: { type: 'object', properties: { cameraId: { type: 'string' } }, required: ['cameraId'] }, annotations: { destructiveHint: true }, handler: (args) => ({ ok: true, triggered: args.cameraId }) },
    { name: 'mixer.switch', description: 'Switch mixer input', inputSchema: { type: 'object', properties: { mixerId: { type: 'string' }, inputNumber: { type: 'number' } }, required: ['mixerId', 'inputNumber'] }, annotations: { destructiveHint: true }, handler: (args) => ({ ok: true, switched: args.inputNumber }) },
    { name: 'caption_target.list', description: 'List targets', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true }, handler: () => ({ ok: true, targets: [] }) },
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
    byName,
    async callTool(name, args, ctx) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      if (!ctx?.apiKey) throw new Error('Missing apiKey');
      return tool.handler(args, ctx);
    },
  };
}

let server, baseUrl, db, bus, apiKey, registry;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  bus = new EventBus();
  apiKey = createKey(db, { owner: 'McpUser' }).key;
  registry = createStubRegistry();

  const app = express();
  app.use(express.json());
  app.use(
    '/mcp',
    createProjectAccessMiddleware(db, JWT_SECRET, { requiredScope: 'mcp:connect' }),
    createMcpEndpointRouter({ registry, eventBus: bus, db }),
  );
  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

function memberToken() {
  return jwt.sign({ apiKey }, JWT_SECRET, { expiresIn: '1h' });
}

async function rpc(method, params, token) {
  const authToken = token || memberToken();
  const url = `${baseUrl}/mcp?token=${authToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || {} }),
  });
  return { status: res.status, body: await res.json() };
}

describe('POST /mcp — MCP endpoint', () => {
  it('requires mcp:connect scope for external tokens', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'no-mcp', scopes: ['events:read'] });
    const res = await fetch(`${baseUrl}/mcp?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(res.status, 403);
  });

  it('initialize returns server info', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'full', scopes: ['mcp:connect'] });
    const { status, body } = await rpc('initialize', {}, token);
    assert.equal(status, 200);
    assert.equal(body.result.serverInfo.name, 'lcyt-mcp');
    assert.equal(body.result.protocolVersion, '2025-03-26');
  });

  it('tools/list returns all tools for session JWT (no scope filtering)', async () => {
    const { body } = await rpc('tools/list');
    assert.equal(body.result.tools.length, 4);
  });

  it('tools/list filters by token scopes', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'cam-only', scopes: ['mcp:connect', 'camera:read', 'camera:write'] });
    const { body } = await rpc('tools/list', {}, token);
    const names = body.result.tools.map((t) => t.name);
    assert(names.includes('camera.list'));
    assert(names.includes('camera.preset'));
    assert(!names.includes('mixer.switch'));
    assert(!names.includes('caption_target.list'));
  });

  it('tools/call executes a read-only tool', async () => {
    const { body } = await rpc('tools/call', { name: 'camera.list', arguments: {} });
    const result = JSON.parse(body.result.content[0].text);
    assert.equal(result.ok, true);
  });

  it('tools/call rejects out-of-scope tool', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'cam-only2', scopes: ['mcp:connect', 'camera:read'] });
    const { body } = await rpc('tools/call', { name: 'mixer.switch', arguments: { mixerId: 'x', inputNumber: 1 } }, token);
    assert.equal(body.error.code, -32001);
    assert(body.error.message.includes('Insufficient scope'));
  });

  it('tools/call executes destructive tool for unscoped (full delegation) tokens', async () => {
    const { token } = createMcpToken(db, apiKey, { label: 'full2', scopes: [] });
    const { body } = await rpc('tools/call', { name: 'camera.preset', arguments: { cameraId: 'cam2' } }, token);
    const result = JSON.parse(body.result.content[0].text);
    assert.equal(result.ok, true);
    assert.equal(result.triggered, 'cam2');
  });

  it('returns error for unknown tool', async () => {
    const { body } = await rpc('tools/call', { name: 'nonexistent.tool', arguments: {} });
    assert.equal(body.error.code, -32601);
  });

  it('returns error for unknown method', async () => {
    const { body } = await rpc('unknown/method');
    assert.equal(body.error.code, -32601);
  });

  it('ping returns empty result', async () => {
    const { body } = await rpc('ping');
    assert.deepEqual(body.result, {});
  });
});

describe('deriveToolScope', () => {
  it('maps camera read-only to camera:read', () => {
    assert.equal(deriveToolScope({ name: 'camera.list', annotations: { readOnlyHint: true } }), 'camera:read');
  });

  it('maps camera destructive to camera:write', () => {
    assert.equal(deriveToolScope({ name: 'camera.preset', annotations: { destructiveHint: true } }), 'camera:write');
  });

  it('maps caption_target to target:read', () => {
    assert.equal(deriveToolScope({ name: 'caption_target.list', annotations: { readOnlyHint: true } }), 'target:read');
  });

  it('maps dsk_template to dsk:write', () => {
    assert.equal(deriveToolScope({ name: 'dsk_template.generate', annotations: {} }), 'dsk:write');
  });
});
