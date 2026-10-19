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

const { createLocalAuthFetch } = await import('../src/lib/authRecovery.js');

test('fetch wrapper: retries a 401 with the renewed project token', async () => {
  localInstall({ backendUrl: 'http://x', projectId: 'p1', projectAccessToken: 'OLD' });
  storage.setItem('lcyt-user', JSON.stringify({ token: 'U1', backendUrl: 'http://x' }));
  const calls = [];
  const base = async (url, opts = {}) => {
    const auth = new Headers(opts.headers || {}).get('Authorization');
    calls.push([url, auth]);
    if (url.endsWith('/auth/local')) return json(200, { token: 'U2' });
    if (url.endsWith('/auth/project-token')) return json(200, { projectAccessToken: 'NEW' });
    return auth === 'Bearer NEW' ? json(200, { ok: true }) : json(401, {});
  };
  globalThis.fetch = base;
  const wrapped = createLocalAuthFetch(base, { isLocal: () => true, recover: (o) => recoverLocalAuth({ storage, base: 'http://x', fetchFn: base, ...o }) });
  const res = await wrapped('http://x/api/v1/production/cameras', { headers: { Authorization: 'Bearer OLD' } });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.at(-1), ['http://x/api/v1/production/cameras', 'Bearer NEW']);
  // a second page still holding OLD is retried too, without another renewal
  const before = calls.length;
  const res2 = await wrapped('http://x/api/v1/production/mixers', { headers: { Authorization: 'Bearer OLD' } });
  assert.equal(res2.status, 200);
  assert.equal(calls.length, before + 2);
});

test('fetch wrapper: leaves non-local installs and other URLs alone', async () => {
  let n = 0;
  const base = async () => { n++; return json(401, {}); };
  const notLocal = createLocalAuthFetch(base, { isLocal: () => false, recover: async () => true });
  assert.equal((await notLocal('http://x/api/v1/a', { headers: { Authorization: 'Bearer T' } })).status, 401);
  const local = createLocalAuthFetch(base, { isLocal: () => true, recover: async () => true });
  assert.equal((await local('http://x/other', { headers: { Authorization: 'Bearer T' } })).status, 401);
  assert.equal((await local('http://x/api/v1/a', { headers: { Authorization: 'Bearer T' } })).status, 401); // no replacement known
  assert.equal(n, 3);
});
