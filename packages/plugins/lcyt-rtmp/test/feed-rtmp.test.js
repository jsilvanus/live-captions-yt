/**
 * Tests for the /feed-rtmp router (plan_ingest_feeds.md §2a, feeds-and-devices PR 7) — nginx-rtmp
 * on_publish/on_publish_done callbacks for named RTMP-pushed feeds (prod_feeds rows with transport 'rtmp').
 *
 * prod_feeds is seeded with plain SQL (same cross-plugin-query convention documented in db/relay.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from 'lcyt-backend/db';
import { createFeedRtmpRouter } from '../src/routes/feed-rtmp.js';
import { RtmpRelayManager } from '../src/rtmp-manager.js';

let db, server, baseUrl, relayManager;

before(async () => {
  db = await initDb(':memory:');

  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport) VALUES ('f-altar', 'owner', 'Altar', 'altar-feed', 'rtmp')").run();
  // A WHIP feed is not accepted on the RTMP gate.
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport) VALUES ('f-laptop', 'owner', 'Laptop', 'laptop-feed', 'whip')").run();

  relayManager = new RtmpRelayManager();
  const app = express();
  app.use('/feed-rtmp', createFeedRtmpRouter(db, relayManager));
  server = createServer(app);
  await new Promise((resolve) => {
    server.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

function postFeedRtmp(path, fields) {
  const body = new URLSearchParams(fields).toString();
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('POST /feed-rtmp (single-URL style)', () => {
  it('returns 400 when name is missing', async () => {
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 403 for a feed key with no matching feed', async () => {
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'no-such-feed' });
    assert.strictEqual(res.status, 403);
  });

  it("returns 403 for a feed key whose feed is not transport 'rtmp' (a WHIP feed)", async () => {
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'laptop-feed' });
    assert.strictEqual(res.status, 403);
  });

  it('returns 200 and marks the feed publishing for a known rtmp feed', async () => {
    assert.ok(!relayManager.isFeedPublishing('altar-feed'));
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'altar-feed' });
    assert.strictEqual(res.status, 200);
    assert.ok(relayManager.isFeedPublishing('altar-feed'));
  });

  it('returns 200 and clears publishing state on publish_done', async () => {
    await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'altar-feed' });
    assert.ok(relayManager.isFeedPublishing('altar-feed'));
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish_done', name: 'altar-feed' });
    assert.strictEqual(res.status, 200);
    assert.ok(!relayManager.isFeedPublishing('altar-feed'));
  });

  it('returns 400 for an unknown call type', async () => {
    const res = await postFeedRtmp('/feed-rtmp', { call: 'bogus', name: 'altar-feed' });
    assert.strictEqual(res.status, 400);
  });
});

describe('POST /feed-rtmp/on_publish and /on_publish_done (separate-URL style)', () => {
  it('on_publish accepts a known feed and marks it publishing', async () => {
    const res = await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-feed' });
    assert.strictEqual(res.status, 200);
    assert.ok(relayManager.isFeedPublishing('altar-feed'));
  });

  it('on_publish_done clears publishing state', async () => {
    await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-feed' });
    const res = await postFeedRtmp('/feed-rtmp/on_publish_done', { name: 'altar-feed' });
    assert.strictEqual(res.status, 200);
    assert.ok(!relayManager.isFeedPublishing('altar-feed'));
  });

  it('on_publish rejects an unknown feed', async () => {
    const res = await postFeedRtmp('/feed-rtmp/on_publish', { name: 'nope' });
    assert.strictEqual(res.status, 403);
  });
});

describe('feed-only egress: on_publish must trigger relay start (code-review follow-up)', () => {
  it('starts the relay for a project whose only slot sources from this feed', async () => {
    await db.prepare("INSERT INTO api_keys (key, owner, relay_active) VALUES ('proj-feedonly', 'owner', 1)").run();
    await db.prepare(`
      INSERT INTO rtmp_relays (api_key, slot, target_url, source_feed_id)
      VALUES ('proj-feedonly', 1, 'rtmp://teams.example.com/live/x', 'f-altar')
    `).run();

    assert.ok(!relayManager.isRunning('proj-feedonly'));
    const res = await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-feed' });
    assert.strictEqual(res.status, 200);
    assert.ok(relayManager.isRunning('proj-feedonly'), 'relay should have started for the referencing project');
    assert.deepEqual(relayManager.runningSlots('proj-feedonly'), [1]);
  });

  it('does not start the relay for a referencing project with relay_active=0', async () => {
    await db.prepare("INSERT INTO api_keys (key, owner, relay_active) VALUES ('proj-inactive', 'owner', 0)").run();
    await db.prepare(`
      INSERT INTO rtmp_relays (api_key, slot, target_url, source_feed_id)
      VALUES ('proj-inactive', 1, 'rtmp://teams.example.com/live/y', 'f-altar')
    `).run();

    await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-feed' });
    assert.ok(!relayManager.isRunning('proj-inactive'));
  });
});
