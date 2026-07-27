import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping lcyt-platforms token-service tests');
  process.exit(0);
}

const { runMigrations, upsertCredential, getCredentialById, revokeCredential } = await import('../src/db.js');
const { encryptSecret, decryptSecret } = await import('../src/crypto.js');
const { createTokenService, CredentialUnusableError, REFRESH_SKEW_MS } = await import('../src/token-service.js');
const { NetworkError } = await import('lcyt/errors');

const KEY = randomBytes(32);
const getKey = () => KEY;

/** ISO in this repo's no-trailing-Z convention. */
const iso = (ms) => new Date(ms).toISOString().replace(/Z$/, '');

function createDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE api_keys (key TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE broadcasts (id TEXT PRIMARY KEY)');
  runMigrations(db);
  db.prepare('INSERT INTO api_keys (key) VALUES (?)').run('key1');
  return db;
}

function seed(db, { expiresAt, accessToken = 'access-current', refreshToken = 'refresh-1' } = {}) {
  return upsertCredential(db, 'key1', {
    platform: 'youtube',
    externalAccountId: 'UC1',
    accountLabel: 'Channel',
    accessTokenEnc: encryptSecret(accessToken, KEY),
    refreshTokenEnc: encryptSecret(refreshToken, KEY),
    expiresAt,
    scopes: 'youtube',
  });
}

/** Adapter stub counting refreshes. */
function makeAdapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      platform: 'youtube',
      async refreshAccessToken(refreshToken) {
        calls.push(refreshToken);
        return { accessToken: 'access-refreshed', expiresIn: 3600, expiresAt: iso(Date.now() + 3600_000) };
      },
      ...overrides,
    },
  };
}

function makeService(db, adapter) {
  return createTokenService({
    db,
    getAdapter: (p) => (p === 'youtube' ? adapter : null),
    getOAuthConfig: () => ({ clientId: 'id', clientSecret: 'secret' }),
    getKey,
  });
}

describe('getAccessToken', () => {
  test('returns the stored token when it is still valid', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() + 3600_000) });
    const { adapter, calls } = makeAdapter();
    const token = await makeService(db, adapter).getAccessToken(row.id);
    assert.equal(token, 'access-current');
    assert.equal(calls.length, 0, 'must not refresh a healthy token');
  });

  test('refreshes inside the expiry skew window', async () => {
    // A token with 30s left would otherwise die mid-request.
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() + REFRESH_SKEW_MS - 1000) });
    const { adapter, calls } = makeAdapter();
    const token = await makeService(db, adapter).getAccessToken(row.id);
    assert.equal(token, 'access-refreshed');
    assert.deepEqual(calls, ['refresh-1']);
  });

  test('persists the refreshed token encrypted', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() - 1000) });
    const { adapter } = makeAdapter();
    await makeService(db, adapter).getAccessToken(row.id);

    const after = getCredentialById(db, row.id);
    assert.notEqual(after.access_token_enc, row.access_token_enc);
    assert.equal(decryptSecret(after.access_token_enc, KEY), 'access-refreshed');
    assert.ok(!after.access_token_enc.includes('access-refreshed'));
    assert.equal(after.refresh_token_enc, row.refresh_token_enc, 'refresh token untouched');
  });

  test('treats an unparseable expiry as expired', async () => {
    // Refreshing unnecessarily is cheap; using a dead token is not.
    const db = createDb();
    const row = seed(db, { expiresAt: 'not-a-date' });
    const { adapter, calls } = makeAdapter();
    assert.equal(await makeService(db, adapter).getAccessToken(row.id), 'access-refreshed');
    assert.equal(calls.length, 1);
  });

  test('forceRefresh bypasses a still-valid token', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() + 3600_000) });
    const { adapter, calls } = makeAdapter();
    await makeService(db, adapter).getAccessToken(row.id, { forceRefresh: true });
    assert.equal(calls.length, 1);
  });

  test('concurrent callers on an expired credential trigger exactly one refresh', async () => {
    // The poller ticking while an operator hits Go Live. Two refreshes racing
    // would both write, and with a provider that rotates refresh tokens the
    // loser's would already be invalid.
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() - 1000) });
    let resolveRefresh;
    const gate = new Promise(r => { resolveRefresh = r; });
    const calls = [];
    const adapter = {
      platform: 'youtube',
      async refreshAccessToken(rt) {
        calls.push(rt);
        await gate;
        return { accessToken: 'access-refreshed', expiresIn: 3600, expiresAt: iso(Date.now() + 3600_000) };
      },
    };
    const service = makeService(db, adapter);

    const all = Promise.all([1, 2, 3, 4, 5].map(() => service.getAccessToken(row.id)));
    resolveRefresh();
    const tokens = await all;

    assert.equal(calls.length, 1, 'exactly one refresh for five concurrent callers');
    assert.deepEqual(tokens, Array(5).fill('access-refreshed'));
  });

  test('a failed refresh does not wedge later attempts', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() - 1000) });
    let attempt = 0;
    const adapter = {
      platform: 'youtube',
      async refreshAccessToken() {
        attempt += 1;
        if (attempt === 1) throw new NetworkError('transient', 503);
        return { accessToken: 'access-refreshed', expiresIn: 3600, expiresAt: iso(Date.now() + 3600_000) };
      },
    };
    const service = makeService(db, adapter);
    await assert.rejects(() => service.getAccessToken(row.id));
    // The in-flight entry must have been cleared, or this would hang or reuse
    // the rejected promise forever.
    assert.equal(await service.getAccessToken(row.id), 'access-refreshed');
  });
});

describe('unusable credentials', () => {
  test('a missing credential', async () => {
    const db = createDb();
    const { adapter } = makeAdapter();
    await assert.rejects(
      () => makeService(db, adapter).getAccessToken('nope'),
      (e) => e instanceof CredentialUnusableError && e.reason === 'missing',
    );
  });

  test('a revoked credential is refused rather than silently used', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() + 3600_000) });
    revokeCredential(db, 'key1', row.id);
    const { adapter } = makeAdapter();
    await assert.rejects(
      () => makeService(db, adapter).getAccessToken(row.id),
      (e) => e instanceof CredentialUnusableError && e.reason === 'revoked',
    );
  });

  test('a 400/401 from the token endpoint means reconnect, not retry', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() - 1000) });
    for (const status of [400, 401]) {
      const adapter = {
        platform: 'youtube',
        async refreshAccessToken() { throw new NetworkError('invalid_grant', status); },
      };
      await assert.rejects(
        () => makeService(db, adapter).getAccessToken(row.id),
        (e) => e instanceof CredentialUnusableError && e.reason === 'grant_revoked',
      );
    }
  });

  test('a transient upstream failure stays a NetworkError', async () => {
    // Distinguishable from "reconnect the account", which is what the route
    // layer turns into different messages.
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() - 1000) });
    const adapter = {
      platform: 'youtube',
      async refreshAccessToken() { throw new NetworkError('upstream down', 503); },
    };
    await assert.rejects(
      () => makeService(db, adapter).getAccessToken(row.id),
      (e) => e instanceof NetworkError && e.statusCode === 503,
    );
  });

  test('an undecryptable refresh token names the likely cause', async () => {
    // The documented cost of PLATFORM_CREDENTIAL_KEY rotation being unbuilt.
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() - 1000) });
    const service = createTokenService({
      db,
      getAdapter: () => makeAdapter().adapter,
      getOAuthConfig: () => ({}),
      getKey: () => randomBytes(32),
    });
    await assert.rejects(
      () => service.getAccessToken(row.id),
      (e) => e instanceof CredentialUnusableError
        && e.reason === 'undecryptable'
        && /PLATFORM_CREDENTIAL_KEY may have changed/.test(e.message),
    );
  });

  test('a corrupt access token still recovers via refresh', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() + 3600_000) });
    db.prepare('UPDATE platform_credentials SET access_token_enc = ? WHERE id = ?')
      .run(encryptSecret('x', randomBytes(32)), row.id);
    const { adapter } = makeAdapter();
    assert.equal(await makeService(db, adapter).getAccessToken(row.id), 'access-refreshed');
  });

  test('an unregistered platform', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() - 1000) });
    db.prepare('UPDATE platform_credentials SET platform = ? WHERE id = ?').run('facebook', row.id);
    const { adapter } = makeAdapter();
    await assert.rejects(
      () => makeService(db, adapter).getAccessToken(row.id),
      (e) => e.reason === 'unsupported_platform',
    );
  });
});

describe('readRefreshToken', () => {
  test('decrypts for the disconnect path only', async () => {
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() + 3600_000) });
    const { adapter } = makeAdapter();
    assert.equal(makeService(db, adapter).readRefreshToken(getCredentialById(db, row.id)), 'refresh-1');
  });

  test('returns null rather than throwing when it cannot decrypt', async () => {
    // Nothing to revoke remotely — the local revocation must still proceed.
    const db = createDb();
    const row = seed(db, { expiresAt: iso(Date.now() + 3600_000) });
    const service = createTokenService({
      db, getAdapter: () => null, getOAuthConfig: () => ({}), getKey: () => randomBytes(32),
    });
    assert.equal(service.readRefreshToken(getCredentialById(db, row.id)), null);
  });
});
