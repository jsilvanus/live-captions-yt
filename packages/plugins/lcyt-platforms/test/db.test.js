import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';


const {
  listCredentials, getCredential, getCredentialById, getDefaultCredential,
  upsertCredential, updateCredentialTokens, revokeCredential, maskCredential,
  getLink, listLinks, upsertLink, updateLink, listLiveLinks, formatLink,
  insertStats, getLatestStats, listStats, peakConcurrentFromSnapshots,
  STATS_LIVE_SNAPSHOT, STATS_POST_SUMMARY,
} = await import('../src/db.js');

const opened = [];
after(async () => { for (const d of opened) await d.close(); });

async function createDb() {
  const db = await initDb(':memory:');
  opened.push(db);
  // Parent rows our foreign keys reference (genuinely enforced on both SQLite and PostgreSQL).
  for (const key of ['key1', 'key2']) await db.api_keys.create({ data: { key, owner: 'test' } });
  for (const id of ['b1', 'b2']) await db.broadcasts.create({ data: { id, api_key: 'key1' } });
  return db;
}

/** Seed a credential and return its id — links reference it for real. */
async function seedCredential(db, apiKey = 'key1', overrides = {}) {
  return (await upsertCredential(db, apiKey, { ...CRED, ...overrides })).id;
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

describe('schema', () => {
  test('the three tables exist and are empty', async () => {
    const db = await createDb();
    assert.equal(await db.platform_credentials.count(), 0);
    assert.equal(await db.broadcast_platform_links.count(), 0);
    assert.equal(await db.broadcast_platform_stats.count(), 0);
  });

  test('credential uniqueness is per-account, not per-platform', async () => {
    // The decision-#1 guard at the schema level: the source plan had
    // UNIQUE(api_key, platform), which would make a second channel impossible.
    const db = await createDb();
    const row = { api_key: 'key1', platform: 'youtube', access_token_enc: 'a', refresh_token_enc: 'r', expires_at: 'x' };
    await db.platform_credentials.create({ data: { id: 'c1', external_account_id: 'UC_a', ...row } });
    await db.platform_credentials.create({ data: { id: 'c2', external_account_id: 'UC_b', ...row } });
    await assert.rejects(() => db.platform_credentials.create({ data: { id: 'c3', external_account_id: 'UC_a', ...row } }));
  });
});

describe('credentials', () => {
  test('upsert then read back', async () => {
    const db = await createDb();
    const row = await upsertCredential(db, 'key1', CRED);
    assert.equal(row.platform, 'youtube');
    assert.equal(row.account_label, 'Channel A');
    assert.equal(row.revoked_at, null);
    assert.equal((await getCredential(db, 'key1', row.id)).id, row.id);
    assert.equal((await getCredentialById(db, row.id)).id, row.id);
  });

  test('a project can connect two different channels on the same platform', async () => {
    const db = await createDb();
    await upsertCredential(db, 'key1', CRED);
    await upsertCredential(db, 'key1', { ...CRED, externalAccountId: 'UC_channel_b', accountLabel: 'Channel B' });
    const rows = await listCredentials(db, 'key1', { platform: 'youtube' });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.account_label).sort(), ['Channel A', 'Channel B']);
  });

  test('reconnecting the same channel replaces its row instead of duplicating', async () => {
    const db = await createDb();
    const first = await upsertCredential(db, 'key1', CRED);
    const second = await upsertCredential(db, 'key1', { ...CRED, accessTokenEnc: 'enc-access-a2', accountLabel: 'Channel A renamed' });
    assert.equal(first.id, second.id);
    assert.equal(second.access_token_enc, 'enc-access-a2');
    assert.equal((await listCredentials(db, 'key1')).length, 1);
  });

  test('reconnecting clears a prior revocation', async () => {
    const db = await createDb();
    const row = await upsertCredential(db, 'key1', CRED);
    await revokeCredential(db, 'key1', row.id);
    assert.equal((await listCredentials(db, 'key1')).length, 0);
    await upsertCredential(db, 'key1', CRED);
    assert.equal((await listCredentials(db, 'key1')).length, 1);
  });

  test('credentials are scoped per project', async () => {
    const db = await createDb();
    const row = await upsertCredential(db, 'key1', CRED);
    assert.equal(await getCredential(db, 'key2', row.id), null);
    assert.equal((await listCredentials(db, 'key2')).length, 0);
  });

  test('revoked credentials are hidden by default but kept for audit', async () => {
    const db = await createDb();
    const row = await upsertCredential(db, 'key1', CRED);
    assert.equal(await revokeCredential(db, 'key1', row.id), true);
    assert.equal((await listCredentials(db, 'key1')).length, 0);
    assert.equal((await listCredentials(db, 'key1', { includeRevoked: true })).length, 1);
    // Revoking twice reports "nothing to do" rather than claiming success.
    assert.equal(await revokeCredential(db, 'key1', row.id), false);
  });

  test('updateCredentialTokens rotates the access token only', async () => {
    const db = await createDb();
    const row = await upsertCredential(db, 'key1', CRED);
    await updateCredentialTokens(db, row.id, { accessTokenEnc: 'enc-access-new', expiresAt: '2026-07-27T13:00:00.000' });
    const after = await getCredentialById(db, row.id);
    assert.equal(after.access_token_enc, 'enc-access-new');
    assert.equal(after.refresh_token_enc, 'enc-refresh-a', 'refresh token must survive an access-token rotation');
  });

  test('maskCredential never emits either ciphertext', async () => {
    const db = await createDb();
    const masked = maskCredential(await upsertCredential(db, 'key1', CRED));
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
  test('resolves when exactly one account is connected', async () => {
    const db = await createDb();
    await upsertCredential(db, 'key1', CRED);
    const result = await getDefaultCredential(db, 'key1', 'youtube');
    assert.equal(result.ok, true);
    assert.equal(result.credential.external_account_id, 'UC_channel_a');
  });

  test('reports "none" with no accounts', async () => {
    const db = await createDb();
    assert.deepEqual(await getDefaultCredential(db, 'key1', 'youtube'), { ok: false, reason: 'none' });
  });

  test('reports "ambiguous" with candidates when several are connected', async () => {
    // Multi-channel means there is no safe guess — the caller must name one.
    const db = await createDb();
    await upsertCredential(db, 'key1', CRED);
    await upsertCredential(db, 'key1', { ...CRED, externalAccountId: 'UC_channel_b', accountLabel: 'Channel B' });
    const result = await getDefaultCredential(db, 'key1', 'youtube');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ambiguous');
    assert.equal(result.candidates.length, 2);
    assert.ok(!JSON.stringify(result.candidates).includes('enc-refresh-a'));
  });

  test('ignores revoked accounts when resolving', async () => {
    const db = await createDb();
    const a = await upsertCredential(db, 'key1', CRED);
    await upsertCredential(db, 'key1', { ...CRED, externalAccountId: 'UC_channel_b', accountLabel: 'Channel B' });
    await revokeCredential(db, 'key1', a.id);
    const result = await getDefaultCredential(db, 'key1', 'youtube');
    assert.equal(result.ok, true);
    assert.equal(result.credential.external_account_id, 'UC_channel_b');
  });
});

describe('broadcast platform links', () => {
  const baseLink = (credentialId) => ({
    broadcastId: 'b1', platform: 'youtube', credentialId,
    externalBroadcastId: 'yt-bc-1', externalStreamId: 'yt-stream-1', lastStatus: 'ready',
  });

  test('upsert creates then updates a single row per (broadcast, platform)', async () => {
    const db = await createDb();
    const LINK = baseLink(await seedCredential(db));
    await upsertLink(db, LINK);
    await upsertLink(db, { ...LINK, externalBroadcastId: 'yt-bc-1-updated' });
    const rows = await listLinks(db, 'b1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].external_broadcast_id, 'yt-bc-1-updated');
  });

  test('upsert preserves stream id and thumbnail when the update omits them', async () => {
    const db = await createDb();
    const LINK = baseLink(await seedCredential(db));
    await upsertLink(db, { ...LINK, thumbnailUrl: 'https://img/1.png' });
    await upsertLink(db, { ...LINK, externalStreamId: null, thumbnailUrl: null });
    const row = await getLink(db, 'b1', 'youtube');
    assert.equal(row.external_stream_id, 'yt-stream-1');
    assert.equal(row.thumbnail_url, 'https://img/1.png');
  });

  test('a link records which credential scheduled it', async () => {
    // So a later poll or transition uses the same channel even after the
    // project connects others.
    const db = await createDb();
    const credId = await seedCredential(db);
    await upsertLink(db, baseLink(credId));
    assert.equal((await getLink(db, 'b1', 'youtube')).credential_id, credId);
  });

  test('updateLink patches status, video ids and sync errors', async () => {
    const db = await createDb();
    const row = await upsertLink(db, baseLink(await seedCredential(db)));
    await updateLink(db, row.id, { lastStatus: 'complete', externalVideoIds: ['v1', 'v2'], lastSyncError: 'quota' });
    const after = await getLink(db, 'b1', 'youtube');
    assert.equal(after.last_status, 'complete');
    assert.deepEqual(JSON.parse(after.external_video_ids), ['v1', 'v2']);
    assert.equal(after.last_sync_error, 'quota');
    assert.ok(after.last_synced_at);
  });

  test('updateLink with an empty patch is a no-op', async () => {
    const db = await createDb();
    const row = await upsertLink(db, baseLink(await seedCredential(db)));
    await assert.doesNotReject(() => updateLink(db, row.id, {}));
    assert.equal((await getLink(db, 'b1', 'youtube')).last_status, 'ready');
  });

  test('listLiveLinks returns only live links', async () => {
    const db = await createDb();
    const LINK = baseLink(await seedCredential(db));
    await upsertLink(db, LINK);
    await upsertLink(db, { ...LINK, broadcastId: 'b2', lastStatus: 'live' });
    const live = await listLiveLinks(db);
    assert.equal(live.length, 1);
    assert.equal(live[0].broadcast_id, 'b2');
  });

  test('formatLink parses video ids and defaults them to an array', async () => {
    const db = await createDb();
    await upsertLink(db, baseLink(await seedCredential(db)));
    assert.deepEqual(formatLink(await getLink(db, 'b1', 'youtube')).externalVideoIds, []);
    assert.equal(formatLink(null), null);
  });
});

describe('stats', () => {
  test('snapshots and summaries coexist and are queried separately', async () => {
    const db = await createDb();
    await insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 10 });
    await insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 42 });
    await insertStats(db, {
      broadcastId: 'b1', platform: 'youtube', kind: STATS_POST_SUMMARY,
      views: 500, averageWatchTimeSec: 120, peakConcurrentViewers: 42,
    });
    assert.equal((await listStats(db, 'b1', 'youtube')).length, 3);
    assert.equal((await listStats(db, 'b1', 'youtube', { kind: STATS_LIVE_SNAPSHOT })).length, 2);
    assert.equal((await getLatestStats(db, 'b1', 'youtube', STATS_POST_SUMMARY)).views, 500);
  });

  test('getLatestStats returns the most recent row when timestamps collide', async () => {
    // datetime('now') has one-second resolution, so two snapshots in the same
    // second are common; the id tiebreak is what makes "latest" deterministic.
    const db = await createDb();
    await insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 1 });
    await insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 2 });
    assert.equal((await getLatestStats(db, 'b1', 'youtube', STATS_LIVE_SNAPSHOT)).concurrent_viewers, 2);
  });

  test('history is ordered oldest-first for charting', async () => {
    const db = await createDb();
    for (const n of [5, 9, 3]) {
      await insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: n });
    }
    assert.deepEqual(
      (await listStats(db, 'b1', 'youtube', { kind: STATS_LIVE_SNAPSHOT })).map(r => r.concurrent_viewers),
      [5, 9, 3],
    );
  });

  test('stats are scoped per broadcast and platform', async () => {
    const db = await createDb();
    await insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 7 });
    assert.equal((await listStats(db, 'b2', 'youtube')).length, 0);
    assert.equal((await listStats(db, 'b1', 'facebook')).length, 0);
  });

  test('peakConcurrentFromSnapshots derives the peak YouTube Analytics does not report', async () => {
    const db = await createDb();
    for (const n of [4, 91, 12]) {
      await insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: n });
    }
    assert.equal(await peakConcurrentFromSnapshots(db, 'b1', 'youtube'), 91);
    assert.equal(await peakConcurrentFromSnapshots(db, 'b2', 'youtube'), null);
  });
});
