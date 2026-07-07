/**
 * Tests for createInProcessMcpBridge — the real MCP Server + in-process
 * Client wiring over InMemoryTransport that lcyt-agent's agentic_chat turn
 * loop consumes. Verifies tools/list and tools/call round-trip through a
 * genuine MCP Server/Client pair, not just the plain registry.callTool().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, createInProcessMcpBridge } from '../src/index.js';

function makeRegistry() {
  const seen = [];
  return createToolRegistry({
    db: {},
    captionTargets: {
      getCaptionTargets: (db, apiKey) => {
        seen.push(['getCaptionTargets', apiKey]);
        return [{ id: 't1', type: 'youtube', owner: apiKey }];
      },
      createCaptionTarget: () => ({ ok: true }),
      updateCaptionTarget: () => ({ ok: true }),
      deleteCaptionTarget: () => true,
    },
    _seen: seen,
  });
}

describe('createInProcessMcpBridge', () => {
  it('exposes the same tool list over a real MCP tools/list call', async () => {
    const registry = makeRegistry();
    const bridge = createInProcessMcpBridge(registry);
    await bridge.connect();

    const listed = await bridge.client.listTools();
    assert.deepEqual(
      listed.tools.map((t) => t.name).sort(),
      registry.tools.map((t) => t.name).sort(),
    );
  });

  it('callToolAs scopes the call to the given apiKey via a real tools/call round-trip', async () => {
    const registry = makeRegistry();
    const bridge = createInProcessMcpBridge(registry);

    const result = await bridge.callToolAs('key1', 'caption_target.list', {});
    assert.equal(result.ok, true);
    assert.equal(result.targets[0].owner, 'key1');

    const resultOther = await bridge.callToolAs('key2', 'caption_target.list', {});
    assert.equal(resultOther.targets[0].owner, 'key2');
  });

  it('strips the reserved _apiKey argument before it reaches the tool handler', async () => {
    let receivedArgs = null;
    const registry = createToolRegistry({
      db: {},
      captionTargets: {
        getCaptionTargets: () => [],
        createCaptionTarget: (db, apiKey, fields) => { receivedArgs = fields; return { ok: true }; },
        updateCaptionTarget: () => ({ ok: true }),
        deleteCaptionTarget: () => true,
      },
    });
    const bridge = createInProcessMcpBridge(registry);
    await bridge.callToolAs('key1', 'caption_target.create', { type: 'youtube', streamKey: 'sk' });
    assert.deepEqual(receivedArgs, { type: 'youtube', streamKey: 'sk' });
    assert.equal(receivedArgs._apiKey, undefined);
  });

  it('surfaces a handler error as a real MCP tool error, not a thrown exception', async () => {
    const registry = createToolRegistry({
      db: {},
      captionTargets: {
        getCaptionTargets: () => { throw new Error('boom'); },
        createCaptionTarget: () => ({ ok: true }),
        updateCaptionTarget: () => ({ ok: true }),
        deleteCaptionTarget: () => true,
      },
    });
    const bridge = createInProcessMcpBridge(registry);
    await assert.rejects(() => bridge.callToolAs('key1', 'caption_target.list', {}), /boom/);
  });

  it('rejects an unknown tool name over the real MCP round-trip', async () => {
    const registry = makeRegistry();
    const bridge = createInProcessMcpBridge(registry);
    await assert.rejects(() => bridge.callToolAs('key1', 'no.such.tool', {}));
  });

  it('connect() is idempotent — repeated calls reuse the same connection', async () => {
    const registry = makeRegistry();
    const bridge = createInProcessMcpBridge(registry);
    const p1 = bridge.connect();
    const p2 = bridge.connect();
    assert.equal(p1, p2);
    await p1;
  });
});
