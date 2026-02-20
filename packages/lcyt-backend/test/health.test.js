import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import { SessionStore } from '../src/store.js';

// ---------------------------------------------------------------------------
// Minimal Express app for health endpoint tests
// ---------------------------------------------------------------------------

let server, baseUrl, store;

before(() => new Promise((resolve) => {
  store = new SessionStore({ cleanupInterval: 0 });

  const app = express();

  app.get('/health', (req, res) => {
    res.status(200).json({
      ok: true,
      uptime: Math.floor(process.uptime()),
      activeSessions: store.size()
    });
  });

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  store.stopCleanup();
  server.close(resolve);
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('should return 200 with ok, uptime, and activeSessions', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(typeof data.uptime, 'number');
    assert.ok(data.uptime >= 0);
    assert.strictEqual(typeof data.activeSessions, 'number');
    assert.strictEqual(data.activeSessions, 0);
  });

  it('should not require authentication', async () => {
    // Verify no auth headers needed
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
  });

  it('should reflect active session count', async () => {
    const mockSender = { end: async () => {} };
    store.create({
      apiKey: 'h-key', streamKey: 'h-stream', domain: 'https://h.com',
      jwt: 'token', sender: mockSender
    });

    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();
    assert.strictEqual(data.activeSessions, 1);

    // Cleanup
    store.remove([...store.all()][0].sessionId);
  });
});
