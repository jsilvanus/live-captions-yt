import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const storage = memoryStorage();
globalThis.localStorage = storage;
globalThis.window = Object.assign(new EventTarget(), { localStorage: storage, location: { origin: 'http://local' } });
const { recoverLocalAuth, recentlyRecovered, resetAuthRecovery, AUTH_RECOVERED_EVENT } = await import('../src/lib/authRecovery.js');

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  resetAuthRecovery();
  for (const k of ['lcyt.backend.features', 'lcyt-user', 'lcyt.session.config']) storage.removeItem(k);
});

function localInstall(cfg) {
  storage.setItem('lcyt.backend.features', JSON.stringify(['local-mode']));
  if (cfg) storage.setItem('lcyt.session.config', JSON.stringify(cfg));
}

test('not a local install: does nothing', async () => {
  let calls = 0;
  assert.equal(await recoverLocalAuth({ storage, base: 'http://x', fetchFn: async () => { calls++; } }), false);
  assert.equal(calls, 0);
});

test('local install: new user token and project token are stored, event fires', async () => {
  localInstall({ backendUrl: 'http://x', projectId: 'p1', projectAccessToken: 'old' });
  const seen = [];
  const fetchFn = async (url, opts) => {
    seen.push([url, opts.headers?.Authorization]);
    return url.endsWith('/auth/local') ? json(200, { token: 'U2' }) : json(200, { projectAccessToken: 'P2' });
  };
  let fired = 0;
  window.addEventListener(AUTH_RECOVERED_EVENT, () => { fired++; }, { once: true });
  assert.equal(await recoverLocalAuth({ storage, base: 'http://x', fetchFn }), true);
  assert.deepEqual(seen, [['http://x/auth/local', undefined], ['http://x/api/v1/auth/project-token', 'Bearer U2']]);
  assert.equal(JSON.parse(storage.getItem('lcyt-user')).token, 'U2');
  assert.equal(JSON.parse(storage.getItem('lcyt.session.config')).projectAccessToken, 'P2');
  assert.equal(fired, 1);
  assert.equal(recentlyRecovered(), true);
});

test('concurrent callers share one attempt; a failure pauses retries', async () => {
  localInstall();
  let calls = 0;
  const fetchFn = async () => { calls++; return json(500, {}); };
  const [a, b] = await Promise.all([recoverLocalAuth({ storage, base: 'http://x', fetchFn }), recoverLocalAuth({ storage, base: 'http://x', fetchFn })]);
  assert.deepEqual([a, b], [false, false]);
  assert.equal(calls, 1);
  assert.equal(await recoverLocalAuth({ storage, base: 'http://x', fetchFn }), false);
  assert.equal(calls, 1);
});
