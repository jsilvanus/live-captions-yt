import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping lcyt-platforms DB tests');
  process.exit(0);
}

const {
  runMigrations,
  listCredentials, getCredential, getCredentialById, getDefaultCredential,
  upsertCredential, updateCredentialTokens, revokeCredential, maskCredential,
  getLink, listLinks, upsertLink, updateLink, listLiveLinks, formatLink,
  insertStats, getLatestStats, listStats, peakConcurrentFromSnapshots,
  STATS_LIVE_SNAPSHOT, STATS_POST_SUMMARY,
} = await import('../src/db.js');

function createDb() {
  const db = new Database(':memory:');
  // Parent tables our FK clauses reference. better-sqlite3 turns
  // `PRAGMA foreign_keys` ON by default, so these are genuinely enforced —
  // the seed rows below are required, not decorative.
  db.exec('CREATE TABLE api_keys (key TEXT PRIMARY KEY)');
  db.exec('CREATE TABLE broadcasts (id TEXT PRIMARY KEY)');
  runMigrations(db);
  for (const key of ['key1', 'key2']) db.prepare('INSERT INTO api_keys (key) VALUES (?)').run(key);
  for (const id of ['b1', 'b2']) db.prepare('INSERT INTO broadcasts (id) VALUES (?)').run(id);
  return db;
}

/** Seed a credential and return its id — links reference it for real. */
function seedCredential(db, apiKey = 'key1', overrides = {}) {
  return upsertCredential(db, apiKey, { ...CRED, ...overrides }).id;
}

const CRED = {
  platform: 'youtube',
  externalAccountId: 'UC_channel_a',
  accountLabel: 'Channel A',
  accessTokenEnc: 'enc-access-a',
  refreshTokenEnc: 'enc-refresh-a',
  expiresAt: '2026-07-27T12:00:00.000',
  scopes: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/yt-analytics.readonly',
};

describe('migrations', () => {
  test('creates all three tables', () => {
    const db = createDb();
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    for (const t of ['platform_credentials', 'broadcast_platform_links', 'broadcast_platform_stats']) {
      assert.ok(names.includes(t), `missing table ${t}`);
    }
  });

  test('is idempotent', () => {
    const db = createDb();
    assert.doesNotThrow(() => { runMigrations(db); runMigrations(db); });
  });

  test('credential uniqueness is per-account, not per-platform', () => {
    // The decision-#1 guard at the schema level: the source plan had
    // UNIQUE(api_key, platform), which would make a second channel impossible.
    const db = createDb();
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='platform_credentials'").get().sql;
    assert.match(idx, /UNIQUE \(api_key, platform, external_account_id\)/);
  });
});

describe('credentials', () => {
  test('upsert then read back', () => {
    const db = createDb();
    const row = upsertCredential(db, 'key1', CRED);
    assert.equal(row.platform, 'youtube');
    assert.equal(row.account_label, 'Channel A');
    assert.equal(row.revoked_at, null);
    assert.equal(getCredential(db, 'key1', row.id).id, row.id);
    assert.equal(getCredentialById(db, row.id).id, row.id);
  });

  test('a project can connect two different channels on the same platform', () => {
    const db = createDb();
    upsertCredential(db, 'key1', CRED);
    upsertCredential(db, 'key1', { ...CRED, externalAccountId: 'UC_channel_b', accountLabel: 'Channel B' });
    const rows = listCredentials(db, 'key1', { platform: 'youtube' });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.account_label).sort(), ['Channel A', 'Channel B']);
  });

  test('reconnecting the same channel replaces its row instead of duplicating', () => {
    const db = createDb();
    const first = upsertCredential(db, 'key1', CRED);
    const second = upsertCredential(db, 'key1', { ...CRED, accessTokenEnc: 'enc-access-a2', accountLabel: 'Channel A renamed' });
    assert.equal(first.id, second.id);
    assert.equal(second.access_token_enc, 'enc-access-a2');
    assert.equal(listCredentials(db, 'key1').length, 1);
  });

  test('reconnecting clears a prior revocation', () => {
    const db = createDb();
    const row = upsertCredential(db, 'key1', CRED);
    revokeCredential(db, 'key1', row.id);
    assert.equal(listCredentials(db, 'key1').length, 0);
    upsertCredential(db, 'key1', CRED);
    assert.equal(listCredentials(db, 'key1').length, 1);
  });

  test('credentials are scoped per project', () => {
    const db = createDb();
    const row = upsertCredential(db, 'key1', CRED);
    assert.equal(getCredential(db, 'key2', row.id), null);
    assert.equal(listCredentials(db, 'key2').length, 0);
  });

  test('revoked credentials are hidden by default but kept for audit', () => {
    const db = createDb();
    const row = upsertCredential(db, 'key1', CRED);
    assert.equal(revokeCredential(db, 'key1', row.id), true);
    assert.equal(listCredentials(db, 'key1').length, 0);
    assert.equal(listCredentials(db, 'key1', { includeRevoked: true }).length, 1);
    // Revoking twice reports "nothing to do" rather than claiming success.
    assert.equal(revokeCredential(db, 'key1', row.id), false);
  });

  test('updateCredentialTokens rotates the access token only', () => {
    const db = createDb();
    const row = upsertCredential(db, 'key1', CRED);
    updateCredentialTokens(db, row.id, { accessTokenEnc: 'enc-access-new', expiresAt: '2026-07-27T13:00:00.000' });
    const after = getCredentialById(db, row.id);
    assert.equal(after.access_token_enc, 'enc-access-new');
    assert.equal(after.refresh_token_enc, 'enc-refresh-a', 'refresh token must survive an access-token rotation');
  });

  test('maskCredential never emits either ciphertext', () => {
    const db = createDb();
    const masked = maskCredential(upsertCredential(db, 'key1', CRED));
    const serialized = JSON.stringify(masked);
    assert.ok(!serialized.includes('enc-access-a'));
    assert.ok(!serialized.includes('enc-refresh-a'));
    assert.equal(masked.accessTokenEnc, undefined);
    assert.equal(masked.refreshTokenEnc, undefined);
    assert.equal(masked.accountLabel, 'Channel A');
    assert.equal(masked.scopes.length, 2);
  });
});

describe('getDefaultCredential', () => {
  test('resolves when exactly one account is connected', () => {
    const db = createDb();
    upsertCredential(db, 'key1', CRED);
    const result = getDefaultCredential(db, 'key1', 'youtube');
    assert.equal(result.ok, true);
    assert.equal(result.credential.external_account_id, 'UC_channel_a');
  });

  test('reports "none" with no accounts', () => {
    const db = createDb();
    assert.deepEqual(getDefaultCredential(db, 'key1', 'youtube'), { ok: false, reason: 'none' });
  });

  test('reports "ambiguous" with candidates when several are connected', () => {
    // Multi-channel means there is no safe guess — the caller must name one.
    const db = createDb();
    upsertCredential(db, 'key1', CRED);
    upsertCredential(db, 'key1', { ...CRED, externalAccountId: 'UC_channel_b', accountLabel: 'Channel B' });
    const result = getDefaultCredential(db, 'key1', 'youtube');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ambiguous');
    assert.equal(result.candidates.length, 2);
    assert.ok(!JSON.stringify(result.candidates).includes('enc-refresh-a'));
  });

  test('ignores revoked accounts when resolving', () => {
    const db = createDb();
    const a = upsertCredential(db, 'key1', CRED);
    upsertCredential(db, 'key1', { ...CRED, externalAccountId: 'UC_channel_b', accountLabel: 'Channel B' });
    revokeCredential(db, 'key1', a.id);
    const result = getDefaultCredential(db, 'key1', 'youtube');
    assert.equal(result.ok, true);
    assert.equal(result.credential.external_account_id, 'UC_channel_b');
  });
});

describe('broadcast platform links', () => {
  const baseLink = (credentialId) => ({
    broadcastId: 'b1', platform: 'youtube', credentialId,
    externalBroadcastId: 'yt-bc-1', externalStreamId: 'yt-stream-1', lastStatus: 'ready',
  });

  test('upsert creates then updates a single row per (broadcast, platform)', () => {
    const db = createDb();
    const LINK = baseLink(seedCredential(db));
    upsertLink(db, LINK);
    upsertLink(db, { ...LINK, externalBroadcastId: 'yt-bc-1-updated' });
    const rows = listLinks(db, 'b1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].external_broadcast_id, 'yt-bc-1-updated');
  });

  test('upsert preserves stream id and thumbnail when the update omits them', () => {
    const db = createDb();
    const LINK = baseLink(seedCredential(db));
    upsertLink(db, { ...LINK, thumbnailUrl: 'https://img/1.png' });
    upsertLink(db, { ...LINK, externalStreamId: null, thumbnailUrl: null });
    const row = getLink(db, 'b1', 'youtube');
    assert.equal(row.external_stream_id, 'yt-stream-1');
    assert.equal(row.thumbnail_url, 'https://img/1.png');
  });

  test('a link records which credential scheduled it', () => {
    // So a later poll or transition uses the same channel even after the
    // project connects others.
    const db = createDb();
    const credId = seedCredential(db);
    upsertLink(db, baseLink(credId));
    assert.equal(getLink(db, 'b1', 'youtube').credential_id, credId);
  });

  test('updateLink patches status, video ids and sync errors', () => {
    const db = createDb();
    const row = upsertLink(db, baseLink(seedCredential(db)));
    updateLink(db, row.id, { lastStatus: 'complete', externalVideoIds: ['v1', 'v2'], lastSyncError: 'quota' });
    const after = getLink(db, 'b1', 'youtube');
    assert.equal(after.last_status, 'complete');
    assert.deepEqual(JSON.parse(after.external_video_ids), ['v1', 'v2']);
    assert.equal(after.last_sync_error, 'quota');
    assert.ok(after.last_synced_at);
  });

  test('updateLink with an empty patch is a no-op', () => {
    const db = createDb();
    const row = upsertLink(db, baseLink(seedCredential(db)));
    assert.doesNotThrow(() => updateLink(db, row.id, {}));
    assert.equal(getLink(db, 'b1', 'youtube').last_status, 'ready');
  });

  test('listLiveLinks returns only live links', () => {
    const db = createDb();
    const LINK = baseLink(seedCredential(db));
    upsertLink(db, LINK);
    upsertLink(db, { ...LINK, broadcastId: 'b2', lastStatus: 'live' });
    const live = listLiveLinks(db);
    assert.equal(live.length, 1);
    assert.equal(live[0].broadcast_id, 'b2');
  });

  test('formatLink parses video ids and defaults them to an array', () => {
    const db = createDb();
    upsertLink(db, baseLink(seedCredential(db)));
    assert.deepEqual(formatLink(getLink(db, 'b1', 'youtube')).externalVideoIds, []);
    assert.equal(formatLink(null), null);
  });
});

describe('stats', () => {
  test('snapshots and summaries coexist and are queried separately', () => {
    const db = createDb();
    insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 10 });
    insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 42 });
    insertStats(db, {
      broadcastId: 'b1', platform: 'youtube', kind: STATS_POST_SUMMARY,
      views: 500, averageWatchTimeSec: 120, peakConcurrentViewers: 42,
    });
    assert.equal(listStats(db, 'b1', 'youtube').length, 3);
    assert.equal(listStats(db, 'b1', 'youtube', { kind: STATS_LIVE_SNAPSHOT }).length, 2);
    assert.equal(getLatestStats(db, 'b1', 'youtube', STATS_POST_SUMMARY).views, 500);
  });

  test('getLatestStats returns the most recent row when timestamps collide', () => {
    // datetime('now') has one-second resolution, so two snapshots in the same
    // second are common; the id tiebreak is what makes "latest" deterministic.
    const db = createDb();
    insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 1 });
    insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 2 });
    assert.equal(getLatestStats(db, 'b1', 'youtube', STATS_LIVE_SNAPSHOT).concurrent_viewers, 2);
  });

  test('history is ordered oldest-first for charting', () => {
    const db = createDb();
    for (const n of [5, 9, 3]) {
      insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: n });
    }
    assert.deepEqual(
      listStats(db, 'b1', 'youtube', { kind: STATS_LIVE_SNAPSHOT }).map(r => r.concurrent_viewers),
      [5, 9, 3],
    );
  });

  test('stats are scoped per broadcast and platform', () => {
    const db = createDb();
    insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 7 });
    assert.equal(listStats(db, 'b2', 'youtube').length, 0);
    assert.equal(listStats(db, 'b1', 'facebook').length, 0);
  });

  test('peakConcurrentFromSnapshots derives the peak YouTube Analytics does not report', () => {
    const db = createDb();
    for (const n of [4, 91, 12]) {
      insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: n });
    }
    assert.equal(peakConcurrentFromSnapshots(db, 'b1', 'youtube'), 91);
    assert.equal(peakConcurrentFromSnapshots(db, 'b2', 'youtube'), null);
  });
});
