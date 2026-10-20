/** createPlatformTransitions: go-live / complete / mark-stopped without an HTTP request. */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';

const { upsertCredential, upsertLink, getLink, revokeCredential } = await import('../src/db.js');
const { createPlatformTransitions } = await import('../src/transitions.js');

describe('platform transitions', () => {
  let db, cred, calls, events, transitions, failNext;

  before(async () => {
    db = await initDb(':memory:');
    await db.api_keys.create({ data: { key: 'k1', owner: 'test' } });
    await db.broadcasts.create({ data: { id: 'b1', api_key: 'k1', title: 'x' } });
    await db.broadcasts.create({ data: { id: 'b2', api_key: 'k1', title: 'unlinked' } });
    cred = await upsertCredential(db, 'k1', {
      platform: 'youtube', externalAccountId: 'ch1', accessTokenEnc: 'a', refreshTokenEnc: 'r', expiresAt: '2099-01-01T00:00:00',
    });
    await upsertLink(db, { broadcastId: 'b1', platform: 'youtube', credentialId: cred.id, externalBroadcastId: 'yt-1' });
    calls = []; events = []; failNext = false;
    transitions = createPlatformTransitions(db, {
      getAdapter: (p) => (p === 'youtube' ? {
        platform: 'youtube',
        transition: async (token, id, status) => { calls.push([token, id, status]); if (failNext) throw new Error('quota'); return { status }; },
      } : null),
      getAccessToken: async () => 'tok',
      eventBus: { publish: (k, topic, data) => events.push({ k, topic, ...data }) },
    });
  });
  after(() => db.close());

  test('goes live on the linked broadcast, records the status and publishes it', async () => {
    const r = await transitions.transition('k1', 'b1', 'live');
    assert.deepEqual(r, { skipped: false, status: 'live' });
    assert.deepEqual(calls.at(-1), ['tok', 'yt-1', 'live']);
    assert.equal((await getLink(db, 'b1', 'youtube')).last_status, 'live');
    assert.equal(events.at(-1).topic, 'platform.status_changed');
  });

  test('a broadcast with no link is skipped, not an error', async () => {
    const r = await transitions.transition('k1', 'b2', 'live');
    assert.equal(r.skipped, true);
    assert.match(r.reason, /not linked/);
  });

  test('markStopped leaves YouTube alone but stops the live-stats poll', async () => {
    const before = calls.length;
    assert.equal(await transitions.markStopped('b1'), true);
    assert.equal(calls.length, before);
    assert.equal((await getLink(db, 'b1', 'youtube')).last_status, 'stopped');
  });

  test('a platform error is recorded on the link and rethrown', async () => {
    failNext = true;
    await assert.rejects(transitions.transition('k1', 'b1', 'complete'), /quota/);
    assert.equal((await getLink(db, 'b1', 'youtube')).last_sync_error, 'quota');
    failNext = false;
    assert.equal((await transitions.transition('k1', 'b1', 'complete')).status, 'complete');
  });

  test('a disconnected account refuses with a readable error', async () => {
    await revokeCredential(db, 'k1', cred.id);
    await assert.rejects(transitions.transition('k1', 'b1', 'live'), /disconnected|No usable/);
  });
});
