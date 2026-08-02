import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping lcyt-platforms stats-poller tests');
  process.exit(0);
}

const {
  runMigrations, upsertCredential, upsertLink, listStats, getLink,
  STATS_LIVE_SNAPSHOT,
} = await import('../src/db.js');
const {
  createStatsPoller, MIN_INTERVAL_MS, DEFAULT_INTERVAL_MS, QUOTA_COOLDOWN_MS,
} = await import('../src/stats-poller.js');
const { NetworkError } = await import('lcyt/errors');

const iso = (ms) => new Date(ms).toISOString().replace(/Z$/, '');

function createDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE api_keys (key TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE broadcasts (id TEXT PRIMARY KEY)');
  runMigrations(db);
  db.prepare('INSERT INTO api_keys (key) VALUES (?)').run('key1');
  for (const id of ['b1', 'b2']) db.prepare('INSERT INTO broadcasts (id) VALUES (?)').run(id);
  return db;
}

function seedLink(db, { broadcastId = 'b1', status = 'live' } = {}) {
  const cred = upsertCredential(db, 'key1', {
    platform: 'youtube',
    externalAccountId: `UC-${broadcastId}`,
    accessTokenEnc: 'enc', refreshTokenEnc: 'enc',
    expiresAt: iso(Date.now() + 3600_000),
  });
  return upsertLink(db, {
    broadcastId, platform: 'youtube', credentialId: cred.id,
    externalBroadcastId: `yt-${broadcastId}`, lastStatus: status,
  });
}

function makePoller(db, { adapter, eventBus, getAccessToken, getIntervalMs } = {}) {
  const events = [];
  const bus = eventBus === undefined
    ? { publish: (projectId, topic, data) => events.push({ projectId, topic, data }) }
    : eventBus;
  const poller = createStatsPoller({
    db,
    getAdapter: () => adapter,
    getAccessToken: getAccessToken || (async () => 'token'),
    getProjectForBroadcast: () => 'key1',
    eventBus: bus,
    getIntervalMs: getIntervalMs || (() => DEFAULT_INTERVAL_MS),
  });
  return { poller, events };
}

const okAdapter = (viewers = 42) => ({
  platform: 'youtube',
  getLiveStats: async () => ({ concurrentViewers: viewers }),
});

describe('tick', () => {
  test('records a snapshot for each live link', async () => {
    const db = createDb();
    seedLink(db);
    const { poller } = makePoller(db, { adapter: okAdapter(137) });
    await poller.tick();
    const rows = listStats(db, 'b1', 'youtube', { kind: STATS_LIVE_SNAPSHOT });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].concurrent_viewers, 137);
  });

  test('ignores links that are not live', async () => {
    // The self-healing property: a broadcast that ends simply stops appearing,
    // with no deregistration step anywhere.
    const db = createDb();
    seedLink(db, { broadcastId: 'b1', status: 'complete' });
    seedLink(db, { broadcastId: 'b2', status: 'live' });
    const { poller } = makePoller(db, { adapter: okAdapter() });
    await poller.tick();
    assert.equal(listStats(db, 'b1', 'youtube').length, 0);
    assert.equal(listStats(db, 'b2', 'youtube').length, 1);
  });

  test('does nothing when no link is live', async () => {
    const db = createDb();
    const { poller } = makePoller(db, {
      adapter: { platform: 'youtube', getLiveStats: async () => { throw new Error('must not be called'); } },
    });
    await assert.doesNotReject(() => poller.tick());
  });

  test('publishes platform.stats_updated so the UI need not poll us in turn', async () => {
    const db = createDb();
    seedLink(db);
    const { poller, events } = makePoller(db, { adapter: okAdapter(9) });
    await poller.tick();
    assert.equal(events.length, 1);
    assert.equal(events[0].projectId, 'key1');
    assert.equal(events[0].topic, 'platform.stats_updated');
    assert.equal(events[0].data.concurrentViewers, 9);
    assert.equal(events[0].data.broadcastId, 'b1');
  });

  test('works without an event bus', async () => {
    const db = createDb();
    seedLink(db);
    const { poller } = makePoller(db, { adapter: okAdapter(), eventBus: null });
    await poller.tick();
    assert.equal(listStats(db, 'b1', 'youtube').length, 1);
  });

  test('records a null viewer count without inventing a zero', async () => {
    // "Not live" and "nobody watching" are different facts.
    const db = createDb();
    seedLink(db);
    const { poller } = makePoller(db, { adapter: okAdapter(null) });
    await poller.tick();
    assert.equal(listStats(db, 'b1', 'youtube')[0].concurrent_viewers, null);
  });
});

describe('failure handling', () => {
  test('one failing broadcast does not stop the others', async () => {
    const db = createDb();
    seedLink(db, { broadcastId: 'b1' });
    seedLink(db, { broadcastId: 'b2' });
    const adapter = {
      platform: 'youtube',
      getLiveStats: async (_t, id) => {
        if (id === 'yt-b1') throw new NetworkError('boom', 500);
        return { concurrentViewers: 5 };
      },
    };
    const { poller } = makePoller(db, { adapter });
    await poller.tick();
    assert.equal(listStats(db, 'b1', 'youtube').length, 0);
    assert.equal(listStats(db, 'b2', 'youtube').length, 1);
  });

  test('records the error on the link so a stale count is explainable', async () => {
    const db = createDb();
    const link = seedLink(db);
    const adapter = { platform: 'youtube', getLiveStats: async () => { throw new NetworkError('upstream down', 503); } };
    const { poller } = makePoller(db, { adapter });
    await poller.tick();
    assert.match(getLink(db, 'b1', 'youtube').last_sync_error, /upstream down/);
    assert.equal(link.last_status, 'live', 'a failed poll must not change the link status');
  });

  test('clears a previous error after a successful poll', async () => {
    const db = createDb();
    seedLink(db);
    let fail = true;
    const adapter = {
      platform: 'youtube',
      getLiveStats: async () => {
        if (fail) { fail = false; throw new NetworkError('blip', 500); }
        return { concurrentViewers: 3 };
      },
    };
    const { poller } = makePoller(db, { adapter });
    await poller.tick();
    await poller.tick();
    assert.equal(getLink(db, 'b1', 'youtube').last_sync_error, null);
  });

  test('an unusable credential is skipped rather than retried tightly', async () => {
    const db = createDb();
    seedLink(db);
    const err = new Error('reconnect required');
    err.name = 'CredentialUnusableError';
    const { poller } = makePoller(db, {
      adapter: okAdapter(),
      getAccessToken: async () => { throw err; },
    });
    await poller.tick();
    assert.equal(listStats(db, 'b1', 'youtube').length, 0);
    assert.match(getLink(db, 'b1', 'youtube').last_sync_error, /reconnect required/);
  });

  test('an unregistered platform is a no-op', async () => {
    const db = createDb();
    seedLink(db);
    const poller = createStatsPoller({
      db, getAdapter: () => null, getAccessToken: async () => 't',
      getProjectForBroadcast: () => 'key1',
    });
    await poller.tick();
    assert.equal(listStats(db, 'b1', 'youtube').length, 0);
  });
});

describe('quota back-off', () => {
  const quotaError = () => {
    const err = new NetworkError('quota exceeded', 403);
    err.reason = 'quotaExceeded';
    return err;
  };

  test('stops the sweep and enters a cooldown', async () => {
    const db = createDb();
    seedLink(db, { broadcastId: 'b1' });
    seedLink(db, { broadcastId: 'b2' });
    let calls = 0;
    const adapter = {
      platform: 'youtube',
      getLiveStats: async () => { calls += 1; throw quotaError(); },
    };
    const { poller } = makePoller(db, { adapter });
    await poller.tick();

    // Quota is per-project upstream, so the remaining links would fail
    // identically — burning quota to prove it is the wrong move.
    assert.equal(calls, 1, 'must break out of the sweep, not walk every link');
    assert.ok(poller.cooldownUntil > Date.now());
  });

  test('skips subsequent ticks until the cooldown expires', async () => {
    const db = createDb();
    seedLink(db);
    let calls = 0;
    const adapter = { platform: 'youtube', getLiveStats: async () => { calls += 1; throw quotaError(); } };
    const { poller } = makePoller(db, { adapter });
    await poller.tick();
    await poller.tick();
    await poller.tick();
    assert.equal(calls, 1, 'no further provider calls during cooldown');
  });

  test('resumes once the cooldown has passed', async () => {
    const db = createDb();
    seedLink(db);
    let calls = 0;
    const adapter = {
      platform: 'youtube',
      getLiveStats: async () => { calls += 1; if (calls === 1) throw quotaError(); return { concurrentViewers: 1 }; },
    };
    const { poller } = makePoller(db, { adapter });
    await poller.tick();
    await poller.tick(Date.now() + QUOTA_COOLDOWN_MS + 1000);
    assert.equal(calls, 2);
    assert.equal(listStats(db, 'b1', 'youtube').length, 1);
  });

  test('an ordinary 403 is not treated as quota', async () => {
    const db = createDb();
    seedLink(db);
    const adapter = {
      platform: 'youtube',
      getLiveStats: async () => { throw new NetworkError('forbidden', 403); },
    };
    const { poller } = makePoller(db, { adapter });
    await poller.tick();
    assert.equal(poller.cooldownUntil, 0);
  });
});

describe('interval handling', () => {
  test('floors a too-small configured interval', () => {
    const db = createDb();
    const { poller } = makePoller(db, { adapter: okAdapter(), getIntervalMs: () => 10 });
    poller.start();
    assert.equal(poller.intervalMs, MIN_INTERVAL_MS);
    poller.stop();
  });

  test('falls back to the default for a nonsense value', () => {
    const db = createDb();
    for (const bad of [0, -5, NaN, undefined]) {
      const { poller } = makePoller(db, { adapter: okAdapter(), getIntervalMs: () => bad });
      poller.start();
      assert.equal(poller.intervalMs, DEFAULT_INTERVAL_MS);
      poller.stop();
    }
  });

  test('start is idempotent but restarts on a changed interval', () => {
    // A live setInterval's delay cannot be changed in place.
    const db = createDb();
    let interval = 30_000;
    const { poller } = makePoller(db, { adapter: okAdapter(), getIntervalMs: () => interval });
    poller.start();
    poller.start();
    assert.equal(poller.intervalMs, 30_000);
    interval = 60_000;
    poller.start();
    assert.equal(poller.intervalMs, 60_000);
    poller.stop();
    assert.equal(poller.intervalMs, 0);
  });

  test('stop is safe to call when not running', () => {
    const db = createDb();
    const { poller } = makePoller(db, { adapter: okAdapter() });
    assert.doesNotThrow(() => { poller.stop(); poller.stop(); });
  });
});
