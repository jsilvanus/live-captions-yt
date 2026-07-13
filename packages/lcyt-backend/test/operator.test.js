/**
 * Tests for the Operator Manager (Phase 2) and operator routes.
 * Covers: start/stop lifecycle, event subscription, action staging/confirmation,
 * cooldown, and status reporting.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { EventBus } from 'lcyt/event-bus';
import { initDb, createKey } from '../src/db.js';
import { createProjectAccessMiddleware } from '../src/middleware/project-access.js';
import { OperatorManager } from '../src/operator-manager.js';
import { createOperatorRouter } from '../src/routes/operator.js';

const JWT_SECRET = 'test-operator-secret';

let server, baseUrl, db, bus, apiKey, operatorManager;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  bus = new EventBus();
  apiKey = createKey(db, { owner: 'OperatorUser' }).key;

  const toolsContext = {
    tools: [
      { name: 'camera.preset', description: 'Trigger preset', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
    ],
    callTool: async (name, args, ctx) => {
      if (name === 'camera.preset') return { ok: true, triggered: args.cameraId };
      throw new Error(`Unknown tool: ${name}`);
    },
  };

  operatorManager = new OperatorManager({ eventBus: bus, db, toolsContext });

  const app = express();
  app.use(express.json());
  app.use(
    '/operator',
    createProjectAccessMiddleware(db, JWT_SECRET, { requiredScope: 'operator' }),
    createOperatorRouter(operatorManager),
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

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const url = `${baseUrl}/operator${path}?token=${memberToken()}`;
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.json() };
}

describe('OperatorManager — unit tests', () => {
  it('starts an operator session', () => {
    const result = operatorManager.start('project-1', { topics: ['cue.fired'], mode: 'confirm' });
    assert.equal(result.ok, true);
    assert.equal(result.session.status, 'running');
    assert.deepEqual(result.session.topics, ['cue.fired']);
    operatorManager.stop('project-1');
  });

  it('prevents duplicate start', () => {
    operatorManager.start('project-2');
    const result = operatorManager.start('project-2');
    assert.equal(result.ok, false);
    assert(result.error.includes('already running'));
    operatorManager.stop('project-2');
  });

  it('stops an operator session', () => {
    operatorManager.start('project-3');
    const result = operatorManager.stop('project-3');
    assert.equal(result.ok, true);
  });

  it('returns status for running/stopped', () => {
    operatorManager.start('project-4');
    const running = operatorManager.status('project-4');
    assert.equal(running.running, true);
    operatorManager.stop('project-4');
    const stopped = operatorManager.status('project-4');
    assert.equal(stopped.running, false);
  });

  it('receives events via bus subscription', async () => {
    operatorManager.start('project-5', { topics: ['external.*'], cooldownMs: 0 });
    bus.publish('project-5', 'external.trigger', { key: 'val' });

    // Give a tick for the handler to fire
    await new Promise((r) => setTimeout(r, 10));

    const status = operatorManager.status('project-5');
    assert(status.contextSize > 0);
    operatorManager.stop('project-5');
  });

  it('confirm/reject pending actions', async () => {
    operatorManager.start('project-6', { mode: 'confirm', cooldownMs: 0 });

    // Manually add a pending action (simulating an evaluator decision)
    const session = operatorManager._sessions.get('project-6');
    const pending = { id: 'test-action-1', tool: 'camera.preset', args: { cameraId: 'cam1' }, reasoning: 'test', ts: Date.now() };
    session.pendingActions.push(pending);

    // Confirm it
    const result = await operatorManager.confirmAction('project-6', 'test-action-1');
    assert.equal(result.ok, true);
    assert.equal(result.action.tool, 'camera.preset');

    // Add another and reject it
    session.pendingActions.push({ id: 'test-action-2', tool: 'camera.preset', args: {}, reasoning: '', ts: Date.now() });
    const rejected = operatorManager.rejectAction('project-6', 'test-action-2');
    assert.equal(rejected.ok, true);

    operatorManager.stop('project-6');
  });
});

describe('Operator routes — HTTP API', () => {
  it('POST /operator/start creates a session', async () => {
    const { status, body } = await req('POST', '/start', { topics: ['external.*'], mode: 'confirm' });
    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.session.status, 'running');
  });

  it('POST /operator/start returns 409 on duplicate', async () => {
    const { status } = await req('POST', '/start');
    assert.equal(status, 409);
  });

  it('GET /operator/status returns running info', async () => {
    const { status, body } = await req('GET', '/status');
    assert.equal(status, 200);
    assert.equal(body.running, true);
  });

  it('GET /operator/pending lists pending actions', async () => {
    const { status, body } = await req('GET', '/pending');
    assert.equal(status, 200);
    assert(Array.isArray(body.actions));
  });

  it('POST /operator/stop stops the session', async () => {
    const { status, body } = await req('POST', '/stop');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it('POST /operator/stop returns 404 when not running', async () => {
    const { status } = await req('POST', '/stop');
    assert.equal(status, 404);
  });

  it('GET /operator/status shows not running', async () => {
    const { status, body } = await req('GET', '/status');
    assert.equal(status, 200);
    assert.equal(body.running, false);
  });
});
