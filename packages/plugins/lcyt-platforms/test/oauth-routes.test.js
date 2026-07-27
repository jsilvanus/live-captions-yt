import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

let Database, express;
try {
  Database = (await import('better-sqlite3')).default;
  express = (await import('express')).default;
} catch {
  console.log('# better-sqlite3/express not available — skipping lcyt-platforms OAuth route tests');
  process.exit(0);
}

const { runMigrations, listCredentials, upsertCredential, getCredentialById } = await import('../src/db.js');
const { encryptSecret } = await import('../src/crypto.js');
const { createOAuthRouter } = await import('../src/routes/oauth.js');
const { createState } = await import('../src/oauth-state.js');
const { createTokenService } = await import('../src/token-service.js');

const JWT_SECRET = 'test-jwt-secret';
const KEY_B64 = randomBytes(32).toString('base64');
const iso = (ms) => new Date(ms).toISOString().replace(/Z$/, '');

/** Adapter double — the routes never touch the real YouTube adapter here. */
function makeAdapter(overrides = {}) {
  return {
    platform: 'youtube',
    scopes: ['scope-a'],
    buildAuthUrl: (state, redirectUri) => `https://consent.test/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => ({
      accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 3600,
      expiresAt: iso(Date.now() + 3600_000), scopes: 'scope-a',
    }),
    getAccountIdentity: async () => ({ externalAccountId: 'UC-a', accountLabel: 'Channel A' }),
    refreshAccessToken: async () => ({ accessToken: 'at-2', expiresIn: 3600, expiresAt: iso(Date.now() + 3600_000) }),
    revokeToken: async () => true,
    ...overrides,
  };
}

describe('lcyt-platforms OAuth routes', () => {
  let server, baseUrl, db, adapterRef;

  before(async () => {
    process.env.PLATFORM_CREDENTIAL_KEY = KEY_B64;
    db = new Database(':memory:');
    db.exec('CREATE TABLE api_keys (key TEXT PRIMARY KEY)');
    db.exec('CREATE TABLE broadcasts (id TEXT PRIMARY KEY)');
    runMigrations(db);
    for (const k of ['key1', 'key2']) db.prepare('INSERT INTO api_keys (key) VALUES (?)').run(k);

    adapterRef = { current: makeAdapter() };

    const tokenService = createTokenService({
      db,
      getAdapter: () => adapterRef.current,
      getOAuthConfig: () => ({ clientId: 'cid', clientSecret: 'csec' }),
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { apiKey: req.headers['x-test-api-key'] || 'key1' }; next(); });
    app.use('/platforms', createOAuthRouter(db, (req, _res, next) => next(), {
      getJwtSecret: () => JWT_SECRET,
      getOAuthConfig: () => ({ clientId: 'cid', clientSecret: 'csec' }),
      getRedirectUri: (p) => `https://lcyt.test/platforms/${p}/oauth/callback`,
      buildReturnUrl: (ok, detail) => `https://lcyt.test/setup/broadcast-platforms?ok=${ok ? '1' : '0'}&reason=${detail.reason || ''}`,
      tokenService,
      // Behaviour runs through a double, but platform *support* is still
      // decided by the real registry — so the "facebook is unreachable" test
      // below is checking the real guarantee, not the stub's.
      getAdapter: () => adapterRef.current,
    }));

    await new Promise((r) => { server = app.listen(0, r); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    delete process.env.PLATFORM_CREDENTIAL_KEY;
    return new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    adapterRef.current = makeAdapter();
    db.exec('DELETE FROM platform_credentials');
  });

  async function call(path, opts = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1', ...(opts.headers || {}) },
      ...opts,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* redirect bodies aren't JSON */ }
    return { status: res.status, body, location: res.headers.get('location') };
  }

  function seedCredential(apiKey = 'key1', overrides = {}) {
    return upsertCredential(db, apiKey, {
      platform: 'youtube',
      externalAccountId: 'UC-seed',
      accountLabel: 'Seeded',
      accessTokenEnc: encryptSecret('at', Buffer.from(KEY_B64, 'base64')),
      refreshTokenEnc: encryptSecret('rt', Buffer.from(KEY_B64, 'base64')),
      expiresAt: iso(Date.now() + 3600_000),
      scopes: 'scope-a',
      ...overrides,
    });
  }

  // ── GET /platforms ──────────────────────────────────────────────────────
  describe('GET /platforms', () => {
    test('lists connected accounts and never leaks ciphertext', async () => {
      seedCredential();
      const { status, body } = await call('/platforms');
      assert.equal(status, 200);
      assert.equal(body.credentials.length, 1);
      assert.equal(body.credentials[0].accountLabel, 'Seeded');
      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes('access_token_enc'));
      assert.ok(!serialized.includes('refresh_token_enc'));
    });

    test('reports several accounts on one platform', async () => {
      seedCredential('key1', { externalAccountId: 'UC-a', accountLabel: 'A' });
      seedCredential('key1', { externalAccountId: 'UC-b', accountLabel: 'B' });
      const { body } = await call('/platforms');
      assert.deepEqual(body.credentials.map(c => c.accountLabel).sort(), ['A', 'B']);
    });

    test('is scoped to the calling project', async () => {
      seedCredential('key2');
      const { body } = await call('/platforms');
      assert.equal(body.credentials.length, 0);
    });

    test('surfaces whether credential storage is even available', async () => {
      const { body } = await call('/platforms');
      assert.equal(body.credentialStorageAvailable, true);
    });
  });

  // ── oauth/start ─────────────────────────────────────────────────────────
  describe('GET /platforms/:platform/oauth/start', () => {
    test('returns a consent URL carrying a signed state', async () => {
      const { status, body } = await call('/platforms/youtube/oauth/start');
      assert.equal(status, 200);
      const url = new URL(body.url);
      const state = url.searchParams.get('state');
      assert.ok(state && state.includes('.'), 'state must be signed');
      assert.equal(url.searchParams.get('redirect_uri'), 'https://lcyt.test/platforms/youtube/oauth/callback');
    });

    test('rejects an unsupported platform', async () => {
      // Facebook's skeleton exists but is unregistered, so it is unreachable.
      const { status, body } = await call('/platforms/facebook/oauth/start');
      assert.equal(status, 404);
      assert.deepEqual(body.supported, ['youtube']);
    });

    test('refuses before redirecting when no credential key is configured', async () => {
      // Completing consent only to fail at the storage step would be worse.
      const saved = process.env.PLATFORM_CREDENTIAL_KEY;
      delete process.env.PLATFORM_CREDENTIAL_KEY;
      const { status, body } = await call('/platforms/youtube/oauth/start');
      process.env.PLATFORM_CREDENTIAL_KEY = saved;
      assert.equal(status, 503);
      assert.equal(body.code, 'no_credential_key');
    });
  });

  // ── oauth/callback ──────────────────────────────────────────────────────
  describe('GET /platforms/:platform/oauth/callback', () => {
    const cb = (params) => `/platforms/youtube/oauth/callback?${new URLSearchParams(params)}`;

    test('stores an encrypted credential and redirects on success', async () => {
      const state = createState({ apiKey: 'key1', platform: 'youtube' }, JWT_SECRET);
      const { status, location } = await call(cb({ code: 'the-code', state }));
      assert.equal(status, 302);
      assert.match(location, /ok=1/);

      const rows = listCredentials(db, 'key1');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].external_account_id, 'UC-a');
      // The whole point of the plan's encryption-at-rest section.
      assert.ok(!rows[0].refresh_token_enc.includes('rt-1'));
      assert.ok(rows[0].access_token_enc.length > 0);
    });

    test('attaches the credential to the project named in the state, not the caller', async () => {
      // The callback is unauthenticated; state is the only binding.
      const state = createState({ apiKey: 'key2', platform: 'youtube' }, JWT_SECRET);
      await call(cb({ code: 'c', state }), { headers: { 'x-test-api-key': 'key1' } });
      assert.equal(listCredentials(db, 'key2').length, 1);
      assert.equal(listCredentials(db, 'key1').length, 0);
    });

    test('rejects a forged state without storing anything', async () => {
      const { status, location } = await call(cb({ code: 'c', state: 'forged.signature' }));
      assert.equal(status, 302);
      assert.match(location, /ok=0.*bad_state/);
      assert.equal(listCredentials(db, 'key1').length, 0);
    });

    test('rejects an expired state', async () => {
      const state = createState({ apiKey: 'key1', platform: 'youtube' }, JWT_SECRET, { now: Date.now() - 3_600_000 });
      const { location } = await call(cb({ code: 'c', state }));
      assert.match(location, /ok=0/);
      assert.equal(listCredentials(db, 'key1').length, 0);
    });

    test('handles the user cancelling consent', async () => {
      const { location } = await call(cb({ error: 'access_denied' }));
      assert.match(location, /ok=0.*denied/);
    });

    test('handles a missing code', async () => {
      const { location } = await call(cb({ state: createState({ apiKey: 'key1', platform: 'youtube' }, JWT_SECRET) }));
      assert.match(location, /missing_code/);
    });

    test('redirects with an error when the code exchange fails', async () => {
      adapterRef.current = makeAdapter({
        exchangeCode: async () => { throw new Error('no refresh token'); },
      });
      const state = createState({ apiKey: 'key1', platform: 'youtube' }, JWT_SECRET);
      const { location } = await call(cb({ code: 'c', state }));
      assert.match(location, /ok=0.*exchange_failed/);
      assert.equal(listCredentials(db, 'key1').length, 0);
    });

    test('connecting a second channel adds rather than replaces', async () => {
      const state1 = createState({ apiKey: 'key1', platform: 'youtube' }, JWT_SECRET);
      await call(cb({ code: 'c1', state: state1 }));

      adapterRef.current = makeAdapter({
        getAccountIdentity: async () => ({ externalAccountId: 'UC-b', accountLabel: 'Channel B' }),
      });
      const state2 = createState({ apiKey: 'key1', platform: 'youtube' }, JWT_SECRET);
      await call(cb({ code: 'c2', state: state2 }));

      // The decision-#1 regression guard at the route level.
      assert.equal(listCredentials(db, 'key1').length, 2);
    });

    test('reconnecting the same channel replaces its row', async () => {
      for (const code of ['c1', 'c2']) {
        const state = createState({ apiKey: 'key1', platform: 'youtube' }, JWT_SECRET);
        await call(cb({ code, state }));
      }
      assert.equal(listCredentials(db, 'key1').length, 1);
    });
  });

  // ── disconnect ──────────────────────────────────────────────────────────
  describe('POST /platforms/:platform/disconnect', () => {
    test('revokes locally and remotely', async () => {
      const row = seedCredential();
      const { status, body } = await call('/platforms/youtube/disconnect', {
        method: 'POST', body: JSON.stringify({ credentialId: row.id }),
      });
      assert.equal(status, 200);
      assert.equal(body.revoked, true);
      assert.equal(body.remoteRevoked, true);
      assert.ok(getCredentialById(db, row.id).revoked_at, 'row kept for audit');
      assert.equal(listCredentials(db, 'key1').length, 0);
    });

    test('still disconnects locally when the provider refuses, and says so', async () => {
      adapterRef.current = makeAdapter({ revokeToken: async () => false });
      const row = seedCredential();
      const { body } = await call('/platforms/youtube/disconnect', {
        method: 'POST', body: JSON.stringify({ credentialId: row.id }),
      });
      assert.equal(body.revoked, true);
      assert.equal(body.remoteRevoked, false);
      assert.match(body.warning, /remove access manually/);
    });

    test('requires an explicit credentialId', async () => {
      // With multi-channel, guessing which account to drop is the wrong thing
      // to be clever about.
      seedCredential();
      const { status, body } = await call('/platforms/youtube/disconnect', {
        method: 'POST', body: JSON.stringify({}),
      });
      assert.equal(status, 400);
      assert.match(body.error, /credentialId is required/);
    });

    test("cannot disconnect another project's credential", async () => {
      const row = seedCredential('key2');
      const { status } = await call('/platforms/youtube/disconnect', {
        method: 'POST', body: JSON.stringify({ credentialId: row.id }),
      });
      assert.equal(status, 404);
      assert.equal(getCredentialById(db, row.id).revoked_at, null);
    });
  });
});
