/**
 * Tests for the /feed-rtmp router (plan_ingest_feeds.md §2a) — nginx-rtmp
 * on_publish/on_publish_done callbacks for named RTMP-pushed feeds
 * ('rtmp'-type prod_cameras rows).
 *
 * prod_cameras is owned by lcyt-production; this plugin has no dependency
 * on it, so the test builds a minimal inline table (same cross-plugin-query
 * convention documented in db/relay.js and feed-rtmp.js itself).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { createFeedRtmpRouter } from '../src/routes/feed-rtmp.js';
import { RtmpRelayManager } from '../src/rtmp-manager.js';
import { runMigrations } from '../src/db.js';

let db, server, baseUrl, relayManager;

before(() => new Promise((resolve) => {
  db = new Database(':memory:');
  // Minimal api_keys stub — runMigrations() below ALTERs it (relay_allowed
  // etc.) and getApiKeysReferencingCamera()/isRelayActive()/getRelays()/
  // getKey() (called from feed-rtmp.js's on_publish, code-review follow-up)
  // need the real rtmp_relays/api_keys shape, not just prod_cameras.
  db.exec('CREATE TABLE api_keys (key TEXT PRIMARY KEY)');
  runMigrations(db);

  db.exec(`
    CREATE TABLE prod_cameras (
      id TEXT PRIMARY KEY,
      camera_key TEXT UNIQUE,
      control_type TEXT NOT NULL DEFAULT 'none'
    )
  `);
  db.prepare("INSERT INTO prod_cameras (id, camera_key, control_type) VALUES ('cam-1', 'altar-cam', 'rtmp')").run();
  // A non-'rtmp' camera with the same-shaped key should NOT be resolvable.
  db.prepare("INSERT INTO prod_cameras (id, camera_key, control_type) VALUES ('cam-2', 'ptz-cam', 'amx')").run();

  relayManager = new RtmpRelayManager();
  const app = express();
  app.use('/feed-rtmp', createFeedRtmpRouter(db, relayManager));
  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

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

  it('returns 403 for a camera_key with no matching rtmp-type camera', async () => {
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'no-such-feed' });
    assert.strictEqual(res.status, 403);
  });

  it("returns 403 for a camera_key whose row exists but isn't control_type='rtmp'", async () => {
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'ptz-cam' });
    assert.strictEqual(res.status, 403);
  });

  it('returns 200 and marks the camera publishing for a known rtmp-type camera', async () => {
    assert.ok(!relayManager.isFeedPublishing('altar-cam'));
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'altar-cam' });
    assert.strictEqual(res.status, 200);
    assert.ok(relayManager.isFeedPublishing('altar-cam'));
  });

  it('returns 200 and clears publishing state on publish_done', async () => {
    await postFeedRtmp('/feed-rtmp', { call: 'publish', name: 'altar-cam' });
    assert.ok(relayManager.isFeedPublishing('altar-cam'));
    const res = await postFeedRtmp('/feed-rtmp', { call: 'publish_done', name: 'altar-cam' });
    assert.strictEqual(res.status, 200);
    assert.ok(!relayManager.isFeedPublishing('altar-cam'));
  });

  it('returns 400 for an unknown call type', async () => {
    const res = await postFeedRtmp('/feed-rtmp', { call: 'bogus', name: 'altar-cam' });
    assert.strictEqual(res.status, 400);
  });
});

describe('POST /feed-rtmp/on_publish and /on_publish_done (separate-URL style)', () => {
  it('on_publish accepts a known feed and marks it publishing', async () => {
    const res = await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-cam' });
    assert.strictEqual(res.status, 200);
    assert.ok(relayManager.isFeedPublishing('altar-cam'));
  });

  it('on_publish_done clears publishing state', async () => {
    await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-cam' });
    const res = await postFeedRtmp('/feed-rtmp/on_publish_done', { name: 'altar-cam' });
    assert.strictEqual(res.status, 200);
    assert.ok(!relayManager.isFeedPublishing('altar-cam'));
  });

  it('on_publish rejects an unknown feed', async () => {
    const res = await postFeedRtmp('/feed-rtmp/on_publish', { name: 'nope' });
    assert.strictEqual(res.status, 403);
  });
});

describe('camera-only egress: on_publish must trigger relay start (code-review follow-up)', () => {
  it('starts the relay for a project whose only slot sources from this camera', async () => {
    db.prepare("INSERT INTO api_keys (key, relay_active) VALUES ('proj-camonly', 1)").run();
    db.prepare(`
      INSERT INTO rtmp_relays (api_key, slot, target_url, source_camera_id)
      VALUES ('proj-camonly', 1, 'rtmp://teams.example.com/live/x', 'cam-1')
    `).run();

    assert.ok(!relayManager.isRunning('proj-camonly'));
    const res = await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-cam' });
    assert.strictEqual(res.status, 200);
    assert.ok(relayManager.isRunning('proj-camonly'), 'relay should have started for the referencing project');
    assert.deepEqual(relayManager.runningSlots('proj-camonly'), [1]);
  });

  it('does not start the relay for a referencing project with relay_active=0', async () => {
    db.prepare("INSERT INTO api_keys (key, relay_active) VALUES ('proj-inactive', 0)").run();
    db.prepare(`
      INSERT INTO rtmp_relays (api_key, slot, target_url, source_camera_id)
      VALUES ('proj-inactive', 1, 'rtmp://teams.example.com/live/y', 'cam-1')
    `).run();

    await postFeedRtmp('/feed-rtmp/on_publish', { name: 'altar-cam' });
    assert.ok(!relayManager.isRunning('proj-inactive'));
  });
});
