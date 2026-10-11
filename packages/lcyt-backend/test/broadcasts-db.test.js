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
  duplicateBroadcast, listBroadcastFiles, linkBroadcastFile, unlinkBroadcastFile,
  linkAsset, unlinkAsset,
  autoCreateForSession, bindSessionStart, completeBroadcast,
} from '../src/db/broadcasts.js';

const KEY = 'bcast-test-key';

let db;
before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner, active) VALUES (?, 'Owner', 1)").run(KEY);
});
after(() => db.close());

beforeEach(async () => {
  await db.prepare('DELETE FROM broadcast_assets').run();
  await db.prepare('DELETE FROM broadcast_files').run();
  await db.prepare('DELETE FROM caption_files WHERE api_key = ?').run(KEY);
  await db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(KEY);
});

describe('createBroadcast / getBroadcast', () => {
  it('creates a draft with defaults and returns it', async () => {
    const r = await createBroadcast(db, KEY, { title: 'Sunday Service' });
    assert.equal(r.ok, true);
    assert.equal(r.broadcast.title, 'Sunday Service');
    assert.equal(r.broadcast.status, 'draft');
    assert.deepEqual(r.broadcast.youtubeVideoIds, []);
    assert.deepEqual(r.broadcast.assets, []);
  });

  it('rejects an invalid status', async () => {
    const r = await createBroadcast(db, KEY, { title: 'x', status: 'bogus' });
    assert.equal(r.ok, false);
  });

  it('getBroadcast returns null for unknown id', async () => {
    assert.equal(await getBroadcast(db, KEY, 'nope'), null);
  });
});

describe('listBroadcasts', () => {
  it('excludes archived by default, includes with flag', async () => {
    const a = (await createBroadcast(db, KEY, { title: 'A' })).broadcast;
    await createBroadcast(db, KEY, { title: 'B' });
    await archiveBroadcast(db, KEY, a.id);

    const visible = await listBroadcasts(db, KEY);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].title, 'B');

    const all = await listBroadcasts(db, KEY, { includeArchived: true });
    assert.equal(all.length, 2);
  });

  it('filters by status', async () => {
    await createBroadcast(db, KEY, { title: 'sched', status: 'scheduled' });
    await createBroadcast(db, KEY, { title: 'draft' });
    const sched = await listBroadcasts(db, KEY, { status: 'scheduled' });
    assert.equal(sched.length, 1);
    assert.equal(sched[0].title, 'sched');
  });
});

describe('updateBroadcast', () => {
  it('patches only provided fields', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'orig' })).broadcast;
    const r = await updateBroadcast(db, KEY, b.id, { title: 'new', scheduledStart: '2026-08-01T10:00:00' });
    assert.equal(r.ok, true);
    assert.equal(r.broadcast.title, 'new');
    assert.equal(r.broadcast.scheduledStart, '2026-08-01T10:00:00');
  });

  it('404s for unknown id', async () => {
    const r = await updateBroadcast(db, KEY, 'nope', { title: 'x' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });
});

describe('archive / restore / delete lifecycle', () => {
  it('archive sets status+archived_at; restore clears it', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    const arch = await archiveBroadcast(db, KEY, b.id);
    assert.equal(arch.broadcast.status, 'archived');
    assert.ok(arch.broadcast.archivedAt);

    const rest = await restoreBroadcast(db, KEY, b.id);
    assert.equal(rest.broadcast.status, 'draft');
    assert.equal(rest.broadcast.archivedAt, null);
  });

  it('cannot archive a live broadcast', async () => {
    const b = await autoCreateForSession(db, KEY, {});
    const r = await archiveBroadcast(db, KEY, b.id);
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });

  it('first delete archives (202); second is blocked until cooling-off; then succeeds and nulls produced links', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;

    // First delete → archive
    const first = await deleteBroadcast(db, KEY, b.id);
    assert.equal(first.ok, false);
    assert.equal(first.status, 202);
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'archived');

    // Attach a produced session_stats row to this broadcast
    await db.prepare(
      "INSERT INTO session_stats (session_id, api_key, started_at, ended_at, duration_ms, broadcast_id) VALUES ('s1', ?, 'a', 'b', 1, ?)"
    ).run(KEY, b.id);

    // Second delete → still within cooling-off window → blocked
    const blocked = await deleteBroadcast(db, KEY, b.id);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 409);

    // Backdate archived_at beyond the window
    await db.prepare("UPDATE broadcasts SET archived_at = datetime('now', '-40 days') WHERE id = ?").run(b.id);

    const done = await deleteBroadcast(db, KEY, b.id);
    assert.equal(done.ok, true);
    assert.equal(await getBroadcast(db, KEY, b.id), null);

    // Produced content survives with broadcast_id nulled
    const stat = await db.prepare("SELECT broadcast_id FROM session_stats WHERE session_id = 's1'").get();
    assert.equal(stat.broadcast_id, null);
  });
});

describe('asset linkage', () => {
  it('links, lists, rejects dup, and unlinks', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    const link = await linkAsset(db, KEY, b.id, { assetType: 'graphic', assetRef: '42' });
    assert.equal(link.ok, true);

    const withAssets = await getBroadcast(db, KEY, b.id);
    assert.equal(withAssets.assets.length, 1);
    assert.equal(withAssets.assets[0].assetType, 'graphic');
    assert.equal(withAssets.assets[0].assetRef, '42');

    const dup = await linkAsset(db, KEY, b.id, { assetType: 'graphic', assetRef: '42' });
    assert.equal(dup.ok, false);
    assert.equal(dup.status, 409);

    const un = await unlinkAsset(db, KEY, b.id, link.asset.id);
    assert.equal(un.ok, true);
    assert.equal((await getBroadcast(db, KEY, b.id)).assets.length, 0);
  });

  it('rejects an invalid asset type', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    const r = await linkAsset(db, KEY, b.id, { assetType: 'nonsense', assetRef: '1' });
    assert.equal(r.ok, false);
  });
});

describe('file linkage', () => {
  it('links, lists, rejects dup, and unlinks files for a broadcast', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    const fileId = (await db.prepare(
      'INSERT INTO caption_files (api_key, session_id, filename, lang, format, type) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(KEY, 's1', 'rundown.md', 'en', 'md', 'rundown')).lastInsertRowid;

    const link = await linkBroadcastFile(db, KEY, b.id, fileId);
    assert.equal(link.ok, true);
    assert.equal(link.file.fileId, fileId);

    const listed = await listBroadcastFiles(db, KEY, b.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].fileId, fileId);

    const withFiles = await getBroadcast(db, KEY, b.id);
    assert.equal(withFiles.files.length, 1);
    assert.equal(withFiles.files[0].fileId, fileId);

    const dup = await linkBroadcastFile(db, KEY, b.id, fileId);
    assert.equal(dup.ok, false);
    assert.equal(dup.status, 409);

    const un = await unlinkBroadcastFile(db, KEY, b.id, fileId);
    assert.equal(un.ok, true);
    assert.equal((await listBroadcastFiles(db, KEY, b.id)).length, 0);
  });
});

describe('duplicateBroadcast (same project)', () => {
  it('copies title+links, not produced content, and starts as fresh draft', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'Original', status: 'scheduled', scheduledStart: '2026-08-01T10:00:00' })).broadcast;
    await linkAsset(db, KEY, b.id, { assetType: 'cue', assetRef: 'c1' });
    const fileId = (await db.prepare(
      'INSERT INTO caption_files (api_key, session_id, filename, lang, format, type) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(KEY, 's1', 'rundown.md', 'en', 'md', 'rundown')).lastInsertRowid;
    await linkBroadcastFile(db, KEY, b.id, fileId);
    // Simulate produced content on the source
    await completeBroadcast(db, b.id, { youtubeVideoIds: ['vid123'] });

    const dup = await duplicateBroadcast(db, KEY, b.id);
    assert.equal(dup.ok, true);
    assert.equal(dup.broadcast.title, 'Original (copy)');
    assert.equal(dup.broadcast.status, 'draft');
    assert.deepEqual(dup.broadcast.youtubeVideoIds, []);
    assert.equal(dup.broadcast.scheduledStart, null);
    assert.equal(dup.broadcast.assets.length, 1);
    assert.equal(dup.broadcast.assets[0].assetRef, 'c1');
    assert.equal(dup.broadcast.files.length, 1);
    assert.equal(dup.broadcast.files[0].fileId, fileId);
  });
});

describe('session-lifecycle binding', () => {
  it('autoCreateForSession creates a live broadcast with a timestamp title', async () => {
    const b = await autoCreateForSession(db, KEY, {});
    assert.equal(b.status, 'live');
    assert.match(b.title, /^Broadcast \d{4}-\d{2}-\d{2}/);
  });

  it('bindSessionStart moves draft→live and rejects a second bind', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'x', status: 'scheduled' })).broadcast;
    const bind = await bindSessionStart(db, KEY, b.id);
    assert.equal(bind.ok, true);
    assert.equal(bind.broadcast.status, 'live');
    assert.ok(bind.broadcast.actualStart);

    const second = await bindSessionStart(db, KEY, b.id);
    assert.equal(second.ok, false);
    assert.equal(second.status, 409);
  });

  it('completeBroadcast sets completed + actual_end + youtube ids', async () => {
    const b = await autoCreateForSession(db, KEY, {});
    await completeBroadcast(db, b.id, { youtubeVideoIds: ['abc', 'def'] });
    const done = await getBroadcast(db, KEY, b.id);
    assert.equal(done.status, 'completed');
    assert.ok(done.actualEnd);
    assert.deepEqual(done.youtubeVideoIds, ['abc', 'def']);
  });

  it('completeBroadcast does not revive an archived broadcast', async () => {
    const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
    await archiveBroadcast(db, KEY, b.id);
    await completeBroadcast(db, b.id, {});
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'archived');
  });

  describe('privacyStatus (plan_broadcast_platform_sync)', () => {
    it('defaults to unlisted', async () => {
      // The safe value is the default: a broadcast accidentally created public
      // is a worse failure than one accidentally left unlisted.
      const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
      assert.equal(b.privacyStatus, 'unlisted');
    });

    it('accepts an explicit value on create', async () => {
      const b = (await createBroadcast(db, KEY, { title: 'x', privacyStatus: 'public' })).broadcast;
      assert.equal((await getBroadcast(db, KEY, b.id)).privacyStatus, 'public');
    });

    it('rejects an unknown value on create', async () => {
      const result = await createBroadcast(db, KEY, { title: 'x', privacyStatus: 'everyone' });
      assert.equal(result.ok, false);
      assert.match(result.error, /Invalid privacyStatus/);
    });

    it('is updatable', async () => {
      const b = (await createBroadcast(db, KEY, { title: 'x' })).broadcast;
      const updated = await updateBroadcast(db, KEY, b.id, { privacyStatus: 'private' });
      assert.equal(updated.ok, true);
      assert.equal(updated.broadcast.privacyStatus, 'private');
    });

    it('rejects an unknown value on update without changing anything', async () => {
      const b = (await createBroadcast(db, KEY, { title: 'x', privacyStatus: 'public' })).broadcast;
      const result = await updateBroadcast(db, KEY, b.id, { privacyStatus: 'nonsense' });
      assert.equal(result.ok, false);
      assert.equal((await getBroadcast(db, KEY, b.id)).privacyStatus, 'public');
    });

    it('is left alone by an unrelated update', async () => {
      const b = (await createBroadcast(db, KEY, { title: 'x', privacyStatus: 'private' })).broadcast;
      await updateBroadcast(db, KEY, b.id, { title: 'renamed' });
      assert.equal((await getBroadcast(db, KEY, b.id)).privacyStatus, 'private');
    });
  });
});
