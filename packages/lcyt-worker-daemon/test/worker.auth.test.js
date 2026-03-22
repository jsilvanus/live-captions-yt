import { test } from 'node:test';
import assert from 'node:assert';
import { startServer } from '../src/index.js';

test('worker auth: endpoints require x-worker-auth when token set', async (t) => {
  process.env.WORKER_AUTH_TOKEN = 'secret-token';
  const { app, server, stop } = startServer(0);
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  // attempt POST /jobs without header -> 401
  let res = await fetch(`${base}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.strictEqual(res.status, 401);

  // attempt with wrong header -> 401
  res = await fetch(`${base}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-auth': 'wrong' }, body: JSON.stringify({}) });
  assert.strictEqual(res.status, 401);

  // attempt with correct header -> 200
  res = await fetch(`${base}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-auth': 'secret-token' }, body: JSON.stringify({}) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.jobId);

  // now test caption endpoint requires header
  const jobId = body.jobId;
  res = await fetch(`${base}/jobs/${jobId}/caption`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) });
  assert.strictEqual(res.status, 401);

  res = await fetch(`${base}/jobs/${jobId}/caption`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-worker-auth': 'secret-token' }, body: JSON.stringify({ text: 'hi' }) });
  assert.strictEqual(res.status, 200);

  // delete without header -> 401
  res = await fetch(`${base}/jobs/${jobId}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 401);

  // delete with header -> 200
  res = await fetch(`${base}/jobs/${jobId}`, { method: 'DELETE', headers: { 'x-worker-auth': 'secret-token' } });
  assert.strictEqual(res.status, 200);

  await stop();
  delete process.env.WORKER_AUTH_TOKEN;
});
