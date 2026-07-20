/**
 * Route-level tests for GET /scene/state (plan_video_perception.md Phase 1 Stream B).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let express, jwt;
try {
  express = (await import('express')).default;
  jwt = (await import('jsonwebtoken')).default;
} catch {
  console.log('# deps not available — skipping scene route tests');
  process.exit(0);
}

import { createSceneRouter } from '../src/routes/scene.js';
import { SceneState } from '../src/scene-state.js';

const JWT_SECRET = 'test-scene-secret';

let server, baseUrl, token, sceneState;

function sessionAuth(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    req.session = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

before(() => {
  token = jwt.sign({ sessionId: 's1', apiKey: 'key1' }, JWT_SECRET, { expiresIn: '1h' });
  sceneState = new SceneState();
  const app = express();
  app.use('/scene', createSceneRouter(sessionAuth, sceneState));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
});

after(() => server.close());

function bearer(tok = token) { return { Authorization: `Bearer ${tok}` }; }

describe('GET /scene/state', () => {
  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/scene/state`);
    assert.equal(res.status, 401);
  });

  it('returns the empty/idle snapshot for a fresh project', async () => {
    const res = await fetch(`${baseUrl}/scene/state`, { headers: bearer() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.state.activeSpeaker, null);
    assert.deepEqual(body.state.cameras, {});
    assert.equal(body.state.segmentGuess, null);
  });

  it('reflects the same injected sceneState instance, not a fresh one per request', async () => {
    sceneState.getState('key1').activeSpeaker = { personId: 'p1', cameraId: 'cam1', confidence: 0.9, since: Date.now() };
    const res = await fetch(`${baseUrl}/scene/state`, { headers: bearer() });
    const body = await res.json();
    assert.equal(body.state.activeSpeaker.personId, 'p1');
  });
});
