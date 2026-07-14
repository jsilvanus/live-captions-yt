/**
 * Tests for src/db/broadcasts.js — the Broadcast entity DB helpers.
 * In-memory SQLite; a seeded api_keys row satisfies the FK.
 */

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import {
  listBroadcasts, getBroadcast, createBroadcast, updateBroadcast,
  archiveBroadcast, restoreBroadcast, deleteBroadcast,
  duplicateBroadcast, linkAsset, unlinkAsset,
  autoCreateForSession, bindSessionStart, completeBroadcast,
} from '../src/db/broadcasts.js';

const KEY = 'bcast-test-key';

let db;
before(() => {
  db = initDb(':memory:');
  db.prepare("INSERT INTO api_keys (key, owner, active) VALUES (?, 'Owner', 1)").run(KEY);
});
after(() => db.close());

beforeEach(() => {
  db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(KEY);
});

describe('createBroadcast / getBroadcast', () => {
  it('creates a draft with defaults and returns it', () => {
    const r = createBroadcast(db, KEY, { title: 'Sunday Service' });
    assert.equal(r.ok, true);
    assert.equal(r.broadcast.title, 'Sunday Service');
    assert.equal(r.broadcast.status, 'draft');
    assert.deepEqual(r.broadcast.youtubeVideoIds, []);
    assert.deepEqual(r.broadcast.assets, []);
  });

  it('rejects an invalid status', () => {
    const r = createBroadcast(db, KEY, { title: 'x', status: 'bogus' });
    assert.equal(r.ok, false);
  });

  it('getBroadcast returns null for unknown id', () => {
    assert.equal(getBroadcast(db, KEY, 'nope'), null);
  });
});

describe('listBroadcasts', () => {
  it('excludes archived by default, includes with flag', () => {
    const a = createBroadcast(db, KEY, { title: 'A' }).broadcast;
    createBroadcast(db, KEY, { title: 'B' });
    archiveBroadcast(db, KEY, a.id);

    const visible = listBroadcasts(db, KEY);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].title, 'B');

    const all = listBroadcasts(db, KEY, { includeArchived: true });
    assert.equal(all.length, 2);
  });

  it('filters by status', () => {
    createBroadcast(db, KEY, { title: 'sched', status: 'scheduled' });
    createBroadcast(db, KEY, { title: 'draft' });
    const sched = listBroadcasts(db, KEY, { status: 'scheduled' });
    assert.equal(sched.length, 1);
    assert.equal(sched[0].title, 'sched');
  });
});

describe('updateBroadcast', () => {
  it('patches only provided fields', () => {
    const b = createBroadcast(db, KEY, { title: 'orig' }).broadcast;
    const r = updateBroadcast(db, KEY, b.id, { title: 'new', scheduledStart: '2026-08-01T10:00:00' });
    assert.equal(r.ok, true);
    assert.equal(r.broadcast.title, 'new');
    assert.equal(r.broadcast.scheduledStart, '2026-08-01T10:00:00');
  });

  it('404s for unknown id', () => {
    const r = updateBroadcast(db, KEY, 'nope', { title: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });
});

describe('archive / restore / delete lifecycle', () => {
  it('archive sets status+archived_at; restore clears it', () => {
    const b = createBroadcast(db, KEY, { title: 'x' }).broadcast;
    const arch = archiveBroadcast(db, KEY, b.id);
    assert.equal(arch.broadcast.status, 'archived');
    assert.ok(arch.broadcast.archivedAt);

    const rest = restoreBroadcast(db, KEY, b.id);
    assert.equal(rest.broadcast.status, 'draft');
    assert.equal(rest.broadcast.archivedAt, null);
  });

  it('cannot archive a live broadcast', () => {
    const b = autoCreateForSession(db, KEY, {});
    const r = archiveBroadcast(db, KEY, b.id);
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });

  it('first delete archives (202); second is blocked until cooling-off; then succeeds and nulls produced links', () => {
    const b = createBroadcast(db, KEY, { title: 'x' }).broadcast;

    // First delete → archive
    const first = deleteBroadcast(db, KEY, b.id);
    assert.equal(first.ok, false);
    assert.equal(first.status, 202);
    assert.equal(getBroadcast(db, KEY, b.id).status, 'archived');

    // Attach a produced session_stats row to this broadcast
    db.prepare(
      "INSERT INTO session_stats (session_id, api_key, started_at, ended_at, duration_ms, broadcast_id) VALUES ('s1', ?, 'a', 'b', 1, ?)"
    ).run(KEY, b.id);

    // Second delete → still within cooling-off window → blocked
    const blocked = deleteBroadcast(db, KEY, b.id);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 409);

    // Backdate archived_at beyond the window
    db.prepare("UPDATE broadcasts SET archived_at = datetime('now', '-40 days') WHERE id = ?").run(b.id);

    const done = deleteBroadcast(db, KEY, b.id);
    assert.equal(done.ok, true);
    assert.equal(getBroadcast(db, KEY, b.id), null);

    // Produced content survives with broadcast_id nulled
    const stat = db.prepare("SELECT broadcast_id FROM session_stats WHERE session_id = 's1'").get();
    assert.equal(stat.broadcast_id, null);
  });
});

describe('asset linkage', () => {
  it('links, lists, rejects dup, and unlinks', () => {
    const b = createBroadcast(db, KEY, { title: 'x' }).broadcast;
    const link = linkAsset(db, KEY, b.id, { assetType: 'graphic', assetRef: '42' });
    assert.equal(link.ok, true);

    const withAssets = getBroadcast(db, KEY, b.id);
    assert.equal(withAssets.assets.length, 1);
    assert.equal(withAssets.assets[0].assetType, 'graphic');
    assert.equal(withAssets.assets[0].assetRef, '42');

    const dup = linkAsset(db, KEY, b.id, { assetType: 'graphic', assetRef: '42' });
    assert.equal(dup.ok, false);
    assert.equal(dup.status, 409);

    const un = unlinkAsset(db, KEY, b.id, link.asset.id);
    assert.equal(un.ok, true);
    assert.equal(getBroadcast(db, KEY, b.id).assets.length, 0);
  });

  it('rejects an invalid asset type', () => {
    const b = createBroadcast(db, KEY, { title: 'x' }).broadcast;
    const r = linkAsset(db, KEY, b.id, { assetType: 'nonsense', assetRef: '1' });
    assert.equal(r.ok, false);
  });
});

describe('duplicateBroadcast (same project)', () => {
  it('copies title+links, not produced content, and starts as fresh draft', () => {
    const b = createBroadcast(db, KEY, { title: 'Original', status: 'scheduled', scheduledStart: '2026-08-01T10:00:00' }).broadcast;
    linkAsset(db, KEY, b.id, { assetType: 'cue', assetRef: 'c1' });
    // Simulate produced content on the source
    completeBroadcast(db, b.id, { youtubeVideoIds: ['vid123'] });

    const dup = duplicateBroadcast(db, KEY, b.id);
    assert.equal(dup.ok, true);
    assert.equal(dup.broadcast.title, 'Original (copy)');
    assert.equal(dup.broadcast.status, 'draft');
    assert.deepEqual(dup.broadcast.youtubeVideoIds, []);
    assert.equal(dup.broadcast.scheduledStart, null);
    assert.equal(dup.broadcast.assets.length, 1);
    assert.equal(dup.broadcast.assets[0].assetRef, 'c1');
  });
});

describe('session-lifecycle binding', () => {
  it('autoCreateForSession creates a live broadcast with a timestamp title', () => {
    const b = autoCreateForSession(db, KEY, {});
    assert.equal(b.status, 'live');
    assert.match(b.title, /^Broadcast \d{4}-\d{2}-\d{2}/);
  });

  it('bindSessionStart moves draft→live and rejects a second bind', () => {
    const b = createBroadcast(db, KEY, { title: 'x', status: 'scheduled' }).broadcast;
    const bind = bindSessionStart(db, KEY, b.id);
    assert.equal(bind.ok, true);
    assert.equal(bind.broadcast.status, 'live');
    assert.ok(bind.broadcast.actualStart);

    const second = bindSessionStart(db, KEY, b.id);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
  });

  it('completeBroadcast sets completed + actual_end + youtube ids', () => {
    const b = autoCreateForSession(db, KEY, {});
    completeBroadcast(db, b.id, { youtubeVideoIds: ['abc', 'def'] });
    const done = getBroadcast(db, KEY, b.id);
    assert.equal(done.status, 'completed');
    assert.ok(done.actualEnd);
    assert.deepEqual(done.youtubeVideoIds, ['abc', 'def']);
  });

  it('completeBroadcast does not revive an archived broadcast', () => {
    const b = createBroadcast(db, KEY, { title: 'x' }).broadcast;
    archiveBroadcast(db, KEY, b.id);
    completeBroadcast(db, b.id, {});
    assert.equal(getBroadcast(db, KEY, b.id).status, 'archived');
  });
});
