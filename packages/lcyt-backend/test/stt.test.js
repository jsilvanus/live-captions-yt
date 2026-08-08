/**
 * Tests for the /stt router (status, start, stop, config, events).
 *
 * Uses an in-memory SQLite DB and a mock SttManager so no real Google STT
 * calls are made.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { EventEmitter } from 'node:events';
import { initDb, createKey } from '../src/db.js';
import { createUser } from '../src/db/users.js';
import { addMember } from '../src/db/project-members.js';
import { createProjectAccessMiddleware } from '../src/middleware/project-access.js';
import { createSttRouter } from '../src/routes/stt.js';
import { setSttConfig, getSttConfig } from 'lcyt-rtmp';
import { runMigrations } from '../../plugins/lcyt-rtmp/src/db.js';

const JWT_SECRET = 'test-stt-secret';
const API_KEY    = 'test-api-key-stt';
const DOMAIN     = 'test.local';

// ── Mock SttManager ──────────────────────────────────────────────────────────

function makeMockSttManager() {
  const mgr = new EventEmitter();
  const _running = new Map();

  mgr.start = async (apiKey, opts = {}) => {
    _running.set(apiKey, { provider: opts.provider || 'google', language: opts.language || 'en-US', audioSource: opts.audioSource || 'hls', startedAt: new Date(), segmentsSent: 0, lastTranscript: null });
  };
  mgr.stop = async (apiKey) => {
    _running.delete(apiKey);
    mgr.emit('stopped', { apiKey });
  };
  mgr.isRunning = (apiKey) => _running.has(apiKey);
  mgr.getStatus = (apiKey) => {
    const s = _running.get(apiKey);
    if (!s) return { running: false };
    return { running: true, ...s };
  };
  mgr.stopAll = async () => {
    for (const k of [..._running.keys()]) await mgr.stop(k);
  };
  return mgr;
}

// ── Test setup ───────────────────────────────────────────────────────────────

let server, baseUrl, db, sttManager, token, ownerToken;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  runMigrations(db);

  // Real API key row (needed so getKey()/getEffectiveProjectAccessLevel() —
  // used by requireProjectRole('setup') on PUT /stt/config — can resolve it).
  createKey(db, { key: API_KEY, owner: 'SttUser' });

  sttManager = makeMockSttManager();

  const app = express();
  app.use(express.json());

  // Real production mounting (server.js) uses scopedAuth()/
  // createProjectAccessMiddleware — matters because PUT /stt/config now goes
  // through requireProjectRole('setup') (plan_project_roles.md, decided
  // 2026-07-26), which needs a real userId. /start,/stop,/status,/events
  // deliberately stay ungated (Production-tier operate actions).
  const auth = createProjectAccessMiddleware(db, JWT_SECRET, { requiredScope: 'stt' });
  app.use('/stt', createSttRouter(auth, sttManager, db, JWT_SECRET));

  // Plain session token — used for status/start/stop/GET config, matching
  // every real session-authenticated caption client.
  token = jwt.sign({ sessionId: 'test-session-id', apiKey: API_KEY }, JWT_SECRET);
  // Explicit project owner — required for PUT /stt/config now.
  const owner = createUser(db, { email: 'stt-owner@example.com', passwordHash: 'x' });
  addMember(db, API_KEY, owner.id, 'owner');
  ownerToken = jwt.sign({ type: 'user', userId: owner.id, email: owner.email, projectId: API_KEY }, JWT_SECRET, { expiresIn: '1h' });

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

// Helper. X-Api-Key mirrors real client behavior — see targets.test.js's
// matching comment / CONSIDER.md.
function bearer(tok = token) {
  return { Authorization: `Bearer ${tok}`, 'X-Api-Key': API_KEY };
}

async function get(path, tok = token) {
  return fetch(`${baseUrl}${path}`, { headers: bearer(tok) });
}

async function post(path, body = {}, tok = token) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { ...bearer(tok), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function put(path, body = {}, tok = ownerToken) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { ...bearer(tok), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/stt routes', () => {

  describe('GET /stt/status', () => {
    it('returns { running: false } when not running', async () => {
      const res = await get('/stt/status');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.running, false);
    });

    it('returns running details after start', async () => {
      await sttManager.start(API_KEY, { provider: 'google', language: 'fi-FI' });
      const res = await get('/stt/status');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.running, true);
      assert.equal(body.provider, 'google');
      assert.equal(body.language, 'fi-FI');
      await sttManager.stop(API_KEY);
    });

    it('rejects missing auth', async () => {
      const res = await fetch(`${baseUrl}/stt/status`);
      assert.equal(res.status, 401);
    });
  });

  describe('POST /stt/start', () => {
    it('starts STT with defaults', async () => {
      const res = await post('/stt/start');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(sttManager.isRunning(API_KEY), true);
      await sttManager.stop(API_KEY);
    });

    it('starts STT with explicit provider and language', async () => {
      const res = await post('/stt/start', { provider: 'google', language: 'fi-FI' });
      assert.equal(res.status, 200);
      const status = sttManager.getStatus(API_KEY);
      assert.equal(status.language, 'fi-FI');
      await sttManager.stop(API_KEY);
    });

    it('rejects invalid provider', async () => {
      const res = await post('/stt/start', { provider: 'invalid_provider' });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.ok(body.error);
    });

    it('rejects invalid audioSource', async () => {
      const res = await post('/stt/start', { audioSource: 'invalid_source' });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /stt/stop', () => {
    it('stops a running STT session', async () => {
      await sttManager.start(API_KEY, { provider: 'google', language: 'en-US' });
      const res = await post('/stt/stop');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(sttManager.isRunning(API_KEY), false);
    });

    it('is a no-op when STT is not running', async () => {
      const res = await post('/stt/stop');
      assert.equal(res.status, 200);
    });
  });

  describe('GET /stt/config', () => {
    it('returns defaults when no config stored', async () => {
      // Remove any existing config for this key
      try { db.prepare('DELETE FROM stt_config WHERE api_key = ?').run('config-test-key'); } catch {}

      const configToken = jwt.sign({ sessionId: 'cfg-session', apiKey: 'config-test-key' }, JWT_SECRET);
      const res = await get('/stt/config', configToken);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.provider, 'google');
      assert.equal(body.language, 'en-US');
      assert.equal(body.autoStart, false);
    });

    it('returns stored config', async () => {
      setSttConfig(db, API_KEY, { provider: 'google', language: 'fi-FI', autoStart: true });
      const res = await get('/stt/config');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.language, 'fi-FI');
      assert.equal(body.autoStart, true);
    });
  });

  describe('PUT /stt/config', () => {
    it('persists config updates', async () => {
      const res = await put('/stt/config', { language: 'sv-SE', autoStart: false });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);

      const cfg = getSttConfig(db, API_KEY);
      assert.equal(cfg.language, 'sv-SE');
      assert.equal(cfg.autoStart, false);
    });

    it('rejects invalid provider in config update', async () => {
      const res = await put('/stt/config', { provider: 'not_a_provider' });
      assert.equal(res.status, 400);
    });

    it('403s for a session token with no explicit project role (setup tier required)', async () => {
      const res = await put('/stt/config', { language: 'fi-FI' }, token);
      assert.equal(res.status, 403);
    });
  });

  describe('GET /stt/events (SSE)', () => {
    it('returns 200 text/event-stream and emits connected event', async () => {
      const res = await fetch(`${baseUrl}/stt/events?token=${encodeURIComponent(token)}`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/event-stream'));

      // Read one event (connected)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
        if (text.includes('event: connected')) break;
      }
      reader.cancel();

      assert.ok(text.includes('event: connected'));
      assert.ok(text.includes('"apiKey"'));
    });

    it('returns 401 for missing token', async () => {
      const res = await fetch(`${baseUrl}/stt/events`);
      assert.equal(res.status, 401);
    });

    it('rejects a forged token (valid JWT shape, wrong signature)', async () => {
      const forged = jwt.sign({ apiKey: API_KEY }, 'wrong-secret');
      const res = await fetch(`${baseUrl}/stt/events?token=${encodeURIComponent(forged)}`);
      assert.equal(res.status, 401);
    });

    it('rejects a hand-crafted unsigned "token" (base64-decodable but not a real JWT)', async () => {
      const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
      const fakePayload = Buffer.from(JSON.stringify({ apiKey: API_KEY })).toString('base64url');
      const forged = `${fakeHeader}.${fakePayload}.`;
      const res = await fetch(`${baseUrl}/stt/events?token=${encodeURIComponent(forged)}`);
      assert.equal(res.status, 401);
    });
  });
});
