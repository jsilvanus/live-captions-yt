import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  runMigrations, upsertManualVariable, getVariable, resolveVariableValue,
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
  beforeEach(() => { db = new Database(':memory:'); runMigrations(db); });

  it('writes the TTL columns on a literal-revert assignment', () => {
    upsertManualVariable(db, K, 'section', {
      value: 'Prayer', ttl: { ms: 20000, captions: null, revertMode: 'literal', revertValue: 'Hymn' },
    });
    const row = getVariable(db, K, 'section');
    assert.equal(row.current_value, 'Prayer');
    assert.ok(row.expires_at, 'expires_at set');
    assert.equal(row.revert_mode, 'literal');
    assert.equal(row.revert_value, 'Hymn');
    assert.equal(row.prev_value, null);
  });

  it('captures prev_value for previous-mode and restores it on revert', () => {
    upsertManualVariable(db, K, 'section', { value: 'Intro' });
    upsertManualVariable(db, K, 'section', {
      value: 'Announcement', ttl: { ms: 20000, captions: null, revertMode: 'previous', revertValue: null },
    });
    assert.equal(getVariable(db, K, 'section').prev_value, 'Intro');
    const reverted = applyRevert(db, K, 'section');
    assert.equal(reverted.current_value, 'Intro');
    assert.equal(reverted.expires_at, null);
    assert.equal(reverted.revert_mode, null);
    assert.equal(reverted.prev_value, null);
  });

  it('baseline revert clears to null and resolves to default_value', () => {
    upsertManualVariable(db, K, 'section', {
      value: 'Prayer', defaultValue: 'Service',
      ttl: { ms: 20000, captions: null, revertMode: 'baseline', revertValue: null },
    });
    const reverted = applyRevert(db, K, 'section');
    assert.equal(reverted.current_value, null);
    assert.equal(resolveVariableValue(reverted), 'Service');
  });

  it('literal revert to empty string clears the value', () => {
    upsertManualVariable(db, K, 'x', {
      value: 'Live', ttl: { ms: 20000, captions: null, revertMode: 'literal', revertValue: '' },
    });
    assert.equal(applyRevert(db, K, 'x').current_value, '');
  });

  it('materializeExpired reverts only rows past due', () => {
    upsertManualVariable(db, K, 'past', {
      value: 'A', ttl: { ms: -1000, captions: null, revertMode: 'literal', revertValue: 'gone' },
    });
    upsertManualVariable(db, K, 'future', {
      value: 'B', ttl: { ms: 60000, captions: null, revertMode: 'literal', revertValue: 'later' },
    });
    const reverted = materializeExpired(db, K);
    assert.deepEqual(reverted.map((r) => r.name), ['past']);
    assert.equal(getVariable(db, K, 'past').current_value, 'gone');
    assert.equal(getVariable(db, K, 'future').current_value, 'B'); // untouched
  });

  it('a subsequent write without a TTL clears the pending expiry (last-write-wins)', () => {
    upsertManualVariable(db, K, 'section', {
      value: 'Prayer', ttl: { ms: 60000, captions: null, revertMode: 'literal', revertValue: 'Hymn' },
    });
    assert.ok(getVariable(db, K, 'section').expires_at);
    upsertManualVariable(db, K, 'section', { value: 'New' });
    const row = getVariable(db, K, 'section');
    assert.equal(row.current_value, 'New');
    assert.equal(row.expires_at, null);
    assert.equal(row.revert_mode, null);
  });

  it('captions-based TTL stores expires_at_seq, no wall-clock expiry', () => {
    upsertManualVariable(db, K, 'lower', {
      value: 'Live', ttl: { ms: null, captions: 5, revertMode: 'baseline', revertValue: null },
    });
    const row = getVariable(db, K, 'lower');
    assert.equal(row.expires_at, null);
    assert.equal(row.expires_at_seq, 5);
    assert.deepEqual(materializeExpired(db, K).map((r) => r.name), []); // time sweep ignores it
  });
});

describe('variable TTL — active scheduler', () => {
  let db;
  beforeEach(() => { db = new Database(':memory:'); runMigrations(db); });

  it('reverts on the timer and emits variable_updated', async () => {
    const bus = fakeBus();
    const scheduler = createTtlScheduler({ db, bus });
    upsertManualVariable(db, K, 'blink', {
      value: 'On', ttl: { ms: 30, captions: null, revertMode: 'literal', revertValue: 'Off' },
    });
    scheduler.reschedule(K, 'blink');
    await delay(90);
    assert.equal(getVariable(db, K, 'blink').current_value, 'Off');
    assert.ok(bus.emitted.some((e) => e.data.name === 'blink' && e.data.value === 'Off'));
    scheduler.cancelAll();
  });

  it('reschedule cancels a pending revert (last-write-wins)', async () => {
    const bus = fakeBus();
    const scheduler = createTtlScheduler({ db, bus });
    upsertManualVariable(db, K, 'v', {
      value: 'On', ttl: { ms: 30, captions: null, revertMode: 'literal', revertValue: 'Off' },
    });
    scheduler.reschedule(K, 'v');
    // Overwrite with no TTL before the timer fires; reschedule should cancel it.
    upsertManualVariable(db, K, 'v', { value: 'Held' });
    scheduler.reschedule(K, 'v');
    await delay(90);
    assert.equal(getVariable(db, K, 'v').current_value, 'Held');
    assert.equal(bus.emitted.length, 0);
    scheduler.cancelAll();
  });

  it('restore() reschedules a persisted expiry and serializes with expiresAt', () => {
    upsertManualVariable(db, K, 'w', {
      value: 'On', ttl: { ms: 60000, captions: null, revertMode: 'baseline', revertValue: null },
    });
    const ser = serializeVariableRow(getVariable(db, K, 'w'));
    assert.ok(ser.expiresAt);
    assert.equal(ser.revertMode, 'baseline');
    const bus = fakeBus();
    const scheduler = createTtlScheduler({ db, bus });
    assert.doesNotThrow(() => scheduler.restore());
    scheduler.cancelAll();
  });
});
