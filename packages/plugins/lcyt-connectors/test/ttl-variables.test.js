import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
import {
  upsertManualVariable, getVariable, resolveVariableValue,
  applyRevert, materializeExpired, serializeVariableRow,
} from '../src/db.js';
import { createTtlScheduler } from '../src/ttl-scheduler.js';

const K = 'test-key';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeBus() {
  return { emitted: [], emitVariableUpdated(apiKey, data) { this.emitted.push({ apiKey, data }); } };
}

describe('variable TTL — storage & revert', () => {
  let db;
  beforeEach(async () => { db = await initDb(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('writes the TTL columns on a literal-revert assignment', async () => {
    await upsertManualVariable(db, K, 'section', {
      value: 'Prayer', ttl: { ms: 20000, captions: null, revertMode: 'literal', revertValue: 'Hymn' },
    });
    const row = await getVariable(db, K, 'section');
    assert.equal(row.current_value, 'Prayer');
    assert.ok(row.expires_at, 'expires_at set');
    assert.equal(row.revert_mode, 'literal');
    assert.equal(row.revert_value, 'Hymn');
    assert.equal(row.prev_value, null);
  });

  it('captures prev_value for previous-mode and restores it on revert', async () => {
    await upsertManualVariable(db, K, 'section', { value: 'Intro' });
    await upsertManualVariable(db, K, 'section', {
      value: 'Announcement', ttl: { ms: 20000, captions: null, revertMode: 'previous', revertValue: null },
    });
    assert.equal((await getVariable(db, K, 'section')).prev_value, 'Intro');
    const reverted = await applyRevert(db, K, 'section');
    assert.equal(reverted.current_value, 'Intro');
    assert.equal(reverted.expires_at, null);
    assert.equal(reverted.revert_mode, null);
    assert.equal(reverted.prev_value, null);
  });

  it('baseline revert clears to null and resolves to default_value', async () => {
    await upsertManualVariable(db, K, 'section', {
      value: 'Prayer', defaultValue: 'Service',
      ttl: { ms: 20000, captions: null, revertMode: 'baseline', revertValue: null },
    });
    const reverted = await applyRevert(db, K, 'section');
    assert.equal(reverted.current_value, null);
    assert.equal(resolveVariableValue(reverted), 'Service');
  });

  it('literal revert to empty string clears the value', async () => {
    await upsertManualVariable(db, K, 'x', {
      value: 'Live', ttl: { ms: 20000, captions: null, revertMode: 'literal', revertValue: '' },
    });
    assert.equal((await applyRevert(db, K, 'x')).current_value, '');
  });

  it('materializeExpired reverts only rows past due', async () => {
    await upsertManualVariable(db, K, 'past', {
      value: 'A', ttl: { ms: -1000, captions: null, revertMode: 'literal', revertValue: 'gone' },
    });
    await upsertManualVariable(db, K, 'future', {
      value: 'B', ttl: { ms: 60000, captions: null, revertMode: 'literal', revertValue: 'later' },
    });
    const reverted = await materializeExpired(db, K);
    assert.deepEqual(reverted.map((r) => r.name), ['past']);
    assert.equal((await getVariable(db, K, 'past')).current_value, 'gone');
    assert.equal((await getVariable(db, K, 'future')).current_value, 'B'); // untouched
  });

  it('a subsequent write without a TTL clears the pending expiry (last-write-wins)', async () => {
    await upsertManualVariable(db, K, 'section', {
      value: 'Prayer', ttl: { ms: 60000, captions: null, revertMode: 'literal', revertValue: 'Hymn' },
    });
    assert.ok((await getVariable(db, K, 'section')).expires_at);
    await upsertManualVariable(db, K, 'section', { value: 'New' });
    const row = await getVariable(db, K, 'section');
    assert.equal(row.current_value, 'New');
    assert.equal(row.expires_at, null);
    assert.equal(row.revert_mode, null);
  });

  it('writes source "file" for file-metacode assignments (namespace unification)', async () => {
    await upsertManualVariable(db, K, 'section', { value: 'Prayer', source: 'file' });
    assert.equal((await getVariable(db, K, 'section')).source, 'file');
    // an unknown/invalid source falls back to manual
    await upsertManualVariable(db, K, 'greeting', { value: 'hi', source: 'bogus' });
    assert.equal((await getVariable(db, K, 'greeting')).source, 'manual');
  });

  it('captions-based TTL stores expires_at_seq, no wall-clock expiry', async () => {
    await upsertManualVariable(db, K, 'lower', {
      value: 'Live', ttl: { ms: null, captions: 5, revertMode: 'baseline', revertValue: null },
    });
    const row = await getVariable(db, K, 'lower');
    assert.equal(row.expires_at, null);
    assert.equal(row.expires_at_seq, 5);
    assert.deepEqual((await materializeExpired(db, K)).map((r) => r.name), []); // time sweep ignores it
  });
});

describe('variable TTL — active scheduler', () => {
  let db;
  beforeEach(async () => { db = await initDb(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('reverts on the timer and emits variable_updated', async () => {
    const bus = fakeBus();
    const scheduler = createTtlScheduler({ db, bus });
    await upsertManualVariable(db, K, 'blink', {
      value: 'On', ttl: { ms: 30, captions: null, revertMode: 'literal', revertValue: 'Off' },
    });
    await scheduler.reschedule(K, 'blink');
    await delay(90);
    assert.equal((await getVariable(db, K, 'blink')).current_value, 'Off');
    assert.ok(bus.emitted.some((e) => e.data.name === 'blink' && e.data.value === 'Off'));
    scheduler.cancelAll();
  });

  it('reschedule cancels a pending revert (last-write-wins)', async () => {
    const bus = fakeBus();
    const scheduler = createTtlScheduler({ db, bus });
    await upsertManualVariable(db, K, 'v', {
      value: 'On', ttl: { ms: 30, captions: null, revertMode: 'literal', revertValue: 'Off' },
    });
    await scheduler.reschedule(K, 'v');
    // Overwrite with no TTL before the timer fires; reschedule should cancel it.
    await upsertManualVariable(db, K, 'v', { value: 'Held' });
    await scheduler.reschedule(K, 'v');
    await delay(90);
    assert.equal((await getVariable(db, K, 'v')).current_value, 'Held');
    assert.equal(bus.emitted.length, 0);
    scheduler.cancelAll();
  });

  it('restore() reschedules a persisted expiry and serializes with expiresAt', async () => {
    await upsertManualVariable(db, K, 'w', {
      value: 'On', ttl: { ms: 60000, captions: null, revertMode: 'baseline', revertValue: null },
    });
    const ser = serializeVariableRow(await getVariable(db, K, 'w'));
    assert.ok(ser.expiresAt);
    assert.equal(ser.revertMode, 'baseline');
    const bus = fakeBus();
    const scheduler = createTtlScheduler({ db, bus });
    await assert.doesNotReject(() => scheduler.restore());
    scheduler.cancelAll();
  });
});
