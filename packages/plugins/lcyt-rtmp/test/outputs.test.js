/**
 * outputs: CRUD, source/cycle checks and the startup backfill (plan_egress_outputs.md PR 1).
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
import {
  createOutput, updateOutput, deleteOutput, listOutputs, getOutput, ensureProjectOutputs, backfillOutputs,
  validateOutputInput, MAX_OUTPUT_CHAIN_DEPTH,
} from '../src/db/outputs.js';

const KEY = 'outproj';
const OTHER = 'otherout';
let db;

async function seed() {
  await db.prepare('DELETE FROM outputs').run();
  await db.prepare('DELETE FROM output_crop_config').run();
  await db.prepare('DELETE FROM prod_feeds').run();
  await db.prepare('DELETE FROM rtmp_relays').run();
  await db.prepare('DELETE FROM crop_config').run();
  await db.prepare('DELETE FROM crop_presets').run();
  await db.prepare('DELETE FROM crop_preset_sets').run();
  await db.prepare('DELETE FROM crop_source_map').run();
  await db.prepare('DELETE FROM dsk_viewports').run();
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('feed-a', ?, 'Main video', 'fa')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('feed-b', ?, 'Cam', 'fb')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('feed-x', ?, 'Foreign', 'fx')").run(OTHER);
  await db.prepare("UPDATE api_keys SET primary_feed_id = 'feed-a' WHERE key = ?").run(KEY);
}

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner) VALUES (?, 'o')").run(KEY);
  await db.prepare("INSERT INTO api_keys (key, owner) VALUES (?, 'o2')").run(OTHER);
});
after(async () => { await db.close(); });
beforeEach(seed);

describe('validateOutputInput', () => {
  it('requires name, sourceType and sourceId on create', () => {
    assert.equal(validateOutputInput({}).ok, false);
    assert.equal(validateOutputInput({ name: 'A', sourceType: 'feed' }).ok, false);
    assert.equal(validateOutputInput({ name: 'A', sourceType: 'x', sourceId: 'f' }).ok, false);
    assert.equal(validateOutputInput({ name: 'A', sourceType: 'feed', sourceId: 'f' }).ok, true);
  });
  it('accepts a partial update and checks audioSource and dsk', () => {
    assert.equal(validateOutputInput({ cropEnabled: true }, { partial: true }).ok, true);
    assert.equal(validateOutputInput({ audioSource: 'nope' }, { partial: true }).ok, false);
    assert.deepEqual(validateOutputInput({ audioSource: { feed: 'f1' } }, { partial: true }).value.audioSource, { feed: 'f1' });
    assert.equal(validateOutputInput({ dsk: ['a', 'a'] }, { partial: true }).ok, false);
  });
});

describe('create / update / delete', () => {
  it('creates an output on a feed of the project and lists it', async () => {
    const r = await createOutput(db, KEY, { name: 'Program', sourceType: 'feed', sourceId: 'feed-a', dsk: ['lower'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.output.dsk, ['lower']);
    assert.equal(r.output.audioSource, 'source');
    assert.equal(r.output.enabled, true);
    assert.equal((await listOutputs(db, KEY)).length, 1);
    assert.equal((await listOutputs(db, OTHER)).length, 0);
  });
  it('rejects a foreign or unknown feed, and a duplicate name', async () => {
    assert.equal((await createOutput(db, KEY, { name: 'A', sourceType: 'feed', sourceId: 'feed-x' })).status, 400);
    assert.equal((await createOutput(db, KEY, { name: 'A', sourceType: 'feed', sourceId: 'nope' })).status, 400);
    assert.equal((await createOutput(db, KEY, { name: 'A', sourceType: 'feed', sourceId: 'feed-a' })).ok, true);
    assert.equal((await createOutput(db, KEY, { name: 'A', sourceType: 'feed', sourceId: 'feed-b' })).status, 409);
  });
  it('chains outputs, refuses loops and over-deep chains', async () => {
    const a = (await createOutput(db, KEY, { name: 'A', sourceType: 'feed', sourceId: 'feed-a' })).output;
    const b = (await createOutput(db, KEY, { name: 'B', sourceType: 'output', sourceId: a.id })).output;
    const loop = await updateOutput(db, KEY, a.id, { sourceType: 'output', sourceId: b.id });
    assert.equal(loop.ok, false);
    const self = await updateOutput(db, KEY, a.id, { sourceType: 'output', sourceId: a.id });
    assert.equal(self.ok, false);
    let prev = b;
    for (let i = 3; i <= MAX_OUTPUT_CHAIN_DEPTH; i++) {
      prev = (await createOutput(db, KEY, { name: `N${i}`, sourceType: 'output', sourceId: prev.id })).output;
    }
    const tooDeep = await createOutput(db, KEY, { name: 'Deep', sourceType: 'output', sourceId: prev.id });
    assert.equal(tooDeep.ok, false);
    assert.match(tooDeep.error, /at most/);
  });
  it('updates only the given fields', async () => {
    const a = (await createOutput(db, KEY, { name: 'A', sourceType: 'feed', sourceId: 'feed-a' })).output;
    const r = await updateOutput(db, KEY, a.id, { cropEnabled: true, audioSource: { feed: 'feed-b' } });
    assert.equal(r.output.cropEnabled, true);
    assert.deepEqual(r.output.audioSource, { feed: 'feed-b' });
    assert.equal(r.output.name, 'A');
    assert.equal((await updateOutput(db, KEY, 'missing', { enabled: false })).status, 404);
  });
  it('refuses to delete an output that has a child or a relay slot, otherwise deletes', async () => {
    const a = (await createOutput(db, KEY, { name: 'A', sourceType: 'feed', sourceId: 'feed-a' })).output;
    const b = (await createOutput(db, KEY, { name: 'B', sourceType: 'output', sourceId: a.id })).output;
    assert.equal((await deleteOutput(db, KEY, a.id)).status, 409);
    await db.prepare("INSERT INTO rtmp_relays (api_key, slot, target_url, source_output_id) VALUES (?, 1, 'rtmp://x/y', ?)").run(KEY, b.id);
    assert.equal((await deleteOutput(db, KEY, b.id)).status, 409);
    await db.prepare('DELETE FROM rtmp_relays').run();
    assert.equal((await deleteOutput(db, KEY, b.id)).ok, true);
    assert.equal((await deleteOutput(db, KEY, a.id)).ok, true);
    assert.equal(await getOutput(db, KEY, a.id), null);
  });
});

describe('ensureProjectOutputs / backfillOutputs', () => {
  it('does nothing for a project without a primary feed', async () => {
    await db.prepare("UPDATE api_keys SET primary_feed_id = NULL WHERE key = ?").run(KEY);
    assert.deepEqual(await ensureProjectOutputs(db, KEY), { program: null, vertical: null });
    assert.equal((await listOutputs(db, KEY)).length, 0);
  });
  it('creates only Program for a project without crop, with the composite viewport', async () => {
    await db.prepare("INSERT INTO dsk_viewports (api_key, name, display_settings_json) VALUES (?, 'lower', ?)")
      .run(KEY, JSON.stringify({ stream: { mode: 'composite' } }));
    await db.prepare("INSERT INTO dsk_viewports (api_key, name, display_settings_json) VALUES (?, 'side', ?)")
      .run(KEY, JSON.stringify({ stream: { mode: 'standalone' } }));
    await db.prepare("INSERT INTO rtmp_relays (api_key, slot, target_url, source_view) VALUES (?, 1, 'rtmp://x/a', 'program')").run(KEY);
    await db.prepare("INSERT INTO rtmp_relays (api_key, slot, target_url, source_view, source_feed_id) VALUES (?, 2, 'rtmp://x/b', 'program', 'feed-b')").run(KEY);
    const r = await ensureProjectOutputs(db, KEY);
    assert.ok(r.program);
    assert.equal(r.vertical, null);
    const [program] = await listOutputs(db, KEY);
    assert.equal(program.name, 'Program');
    assert.deepEqual([program.sourceType, program.sourceId, program.dsk], ['feed', 'feed-a', ['lower']]);
    const slots = await db.prepare('SELECT slot, source_output_id FROM rtmp_relays ORDER BY slot').all();
    assert.equal(slots[0].source_output_id, r.program);
    assert.equal(slots[1].source_output_id, null); // a named-feed slot is left alone
  });
  it('creates Vertical from the legacy crop, copies the config, tags rows and repoints crop slots', async () => {
    await db.prepare("INSERT INTO crop_config (api_key, enabled, aspect_w, aspect_h, follow_program) VALUES (?, 1, 4, 5, 0)").run(KEY);
    await db.prepare("INSERT INTO crop_preset_sets (id, api_key, name) VALUES ('set1', ?, 'Bank')").run(KEY);
    await db.prepare("INSERT INTO crop_presets (id, api_key, set_id, name) VALUES ('p1', ?, 'set1', 'Left')").run(KEY);
    await db.prepare("INSERT INTO crop_source_map (id, api_key, camera_id, preset_id) VALUES ('m1', ?, 'cam', 'p1')").run(KEY);
    await db.prepare("INSERT INTO rtmp_relays (api_key, slot, target_url, source_view) VALUES (?, 1, 'rtmp://x/a', 'program')").run(KEY);
    await db.prepare("INSERT INTO rtmp_relays (api_key, slot, target_url, source_view) VALUES (?, 2, 'rtmp://x/b', 'crop')").run(KEY);
    const r = await ensureProjectOutputs(db, KEY);
    assert.ok(r.program && r.vertical);
    const vertical = await getOutput(db, KEY, r.vertical);
    assert.deepEqual([vertical.name, vertical.sourceType, vertical.sourceId, vertical.cropEnabled], ['Vertical', 'output', r.program, true]);
    const cfg = await db.prepare('SELECT * FROM output_crop_config WHERE output_id = ?').get(r.vertical);
    assert.deepEqual([cfg.enabled, cfg.aspect_w, cfg.aspect_h, cfg.follow_program], [1, 4, 5, 0]);
    for (const [table, id] of [['crop_preset_sets', 'set1'], ['crop_presets', 'p1'], ['crop_source_map', 'm1']]) {
      assert.equal((await db.prepare(`SELECT output_id FROM ${table} WHERE id = ?`).get(id)).output_id, r.vertical);
    }
    const slots = await db.prepare('SELECT slot, source_output_id FROM rtmp_relays ORDER BY slot').all();
    assert.deepEqual(slots.map(s => s.source_output_id), [r.program, r.vertical]);
    // the legacy rows are still there and unchanged for the code that reads them
    assert.equal((await db.prepare('SELECT enabled FROM crop_config WHERE api_key = ?').get(KEY)).enabled, 1);
  });
  it('is idempotent and backfillOutputs counts what it made', async () => {
    const first = await backfillOutputs(db);
    assert.deepEqual(first, { projects: 1, outputs: 1 });
    const again = await backfillOutputs(db);
    assert.deepEqual(again, { projects: 0, outputs: 0 });
    assert.equal((await listOutputs(db, KEY)).length, 1);
  });
});
