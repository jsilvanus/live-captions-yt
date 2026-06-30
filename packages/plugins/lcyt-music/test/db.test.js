import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

describe('lcyt-music db', () => {
  let runMigrations, insertMusicEvent, getMusicEventsPage, getMusicConfig, setMusicConfig;
  let db;

  before(async () => {
    ({ runMigrations, insertMusicEvent, getMusicEventsPage, getMusicConfig, setMusicConfig } =
      await import('../src/db.js'));
  });

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  describe('getMusicEventsPage', () => {
    function seed(n, eventType = 'label_change') {
      for (let i = 0; i < n; i++) {
        insertMusicEvent(db, 'key1', { event_type: eventType, label: 'music', bpm: null, confidence: 0.9 });
      }
    }

    test('returns empty page with total 0 when no events exist', () => {
      const { events, total } = getMusicEventsPage(db, 'key1');
      assert.deepEqual(events, []);
      assert.equal(total, 0);
    });

    test('respects limit and reports total across all matching rows', () => {
      seed(5);
      const { events, total } = getMusicEventsPage(db, 'key1', { limit: 2 });
      assert.equal(events.length, 2);
      assert.equal(total, 5);
    });

    test('respects offset for subsequent pages', () => {
      seed(5);
      const page1 = getMusicEventsPage(db, 'key1', { limit: 2, offset: 0 });
      const page2 = getMusicEventsPage(db, 'key1', { limit: 2, offset: 2 });
      const page1Ids = page1.events.map((e) => e.id);
      const page2Ids = page2.events.map((e) => e.id);
      assert.equal(page1Ids.length, 2);
      assert.equal(page2Ids.length, 2);
      assert.deepEqual(page1Ids.filter((id) => page2Ids.includes(id)), []);
    });

    test('orders newest first (ts DESC, id DESC tiebreaker)', () => {
      seed(3);
      const { events } = getMusicEventsPage(db, 'key1', { limit: 10 });
      const ids = events.map((e) => e.id);
      assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    });

    test('filters by eventType when provided', () => {
      seed(2, 'label_change');
      seed(3, 'bpm_update');
      const { events, total } = getMusicEventsPage(db, 'key1', { limit: 10, eventType: 'bpm_update' });
      assert.equal(total, 3);
      assert.ok(events.every((e) => e.event_type === 'bpm_update'));
    });

    test('only returns events for the requested api_key', () => {
      insertMusicEvent(db, 'key1', { event_type: 'label_change', label: 'music' });
      insertMusicEvent(db, 'key2', { event_type: 'label_change', label: 'speech' });
      const { events, total } = getMusicEventsPage(db, 'key1', { limit: 10 });
      assert.equal(total, 1);
      assert.equal(events[0].label, 'music');
    });

    test('defaults to limit 50, offset 0 when not provided', () => {
      seed(3);
      const { events } = getMusicEventsPage(db, 'key1');
      assert.equal(events.length, 3);
    });
  });

  describe('autoCalibrate config field', () => {
    test('defaults to false when no config row exists', () => {
      const config = getMusicConfig(db, 'key1');
      assert.equal(config.autoCalibrate, false);
    });

    test('round-trips true through setMusicConfig/getMusicConfig', () => {
      setMusicConfig(db, 'key1', { autoCalibrate: true });
      const config = getMusicConfig(db, 'key1');
      assert.equal(config.autoCalibrate, true);
    });

    test('omitted autoCalibrate keeps existing value on patch', () => {
      setMusicConfig(db, 'key1', { autoCalibrate: true });
      setMusicConfig(db, 'key1', { bpmEnabled: false });
      const config = getMusicConfig(db, 'key1');
      assert.equal(config.autoCalibrate, true);
      assert.equal(config.bpmEnabled, false);
    });
  });

  describe('runMigrations idempotency', () => {
    test('running migrations twice does not throw (additive column already present)', () => {
      assert.doesNotThrow(() => runMigrations(db));
    });
  });
});
