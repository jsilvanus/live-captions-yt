import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';

describe('lcyt-music db', () => {
  let insertMusicEvent, getMusicEventsPage, getMusicConfig, setMusicConfig;
  let db;

  before(async () => {
    ({ insertMusicEvent, getMusicEventsPage, getMusicConfig, setMusicConfig } =
      await import('../src/db.js'));
  });

  beforeEach(async () => {
    db = await initDb(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  describe('getMusicEventsPage', () => {
    async function seed(n, eventType = 'label_change') {
      for (let i = 0; i < n; i++) {
        await insertMusicEvent(db, 'key1', { event_type: eventType, label: 'music', bpm: null, confidence: 0.9 });
      }
    }

    test('returns empty page with total 0 when no events exist', async () => {
      const { events, total } = await getMusicEventsPage(db, 'key1');
      assert.deepEqual(events, []);
      assert.equal(total, 0);
    });

    test('respects limit and reports total across all matching rows', async () => {
      await seed(5);
      const { events, total } = await getMusicEventsPage(db, 'key1', { limit: 2 });
      assert.equal(events.length, 2);
      assert.equal(total, 5);
    });

    test('respects offset for subsequent pages', async () => {
      await seed(5);
      const page1 = await getMusicEventsPage(db, 'key1', { limit: 2, offset: 0 });
      const page2 = await getMusicEventsPage(db, 'key1', { limit: 2, offset: 2 });
      const page1Ids = page1.events.map((e) => e.id);
      const page2Ids = page2.events.map((e) => e.id);
      assert.equal(page1Ids.length, 2);
      assert.equal(page2Ids.length, 2);
      assert.deepEqual(page1Ids.filter((id) => page2Ids.includes(id)), []);
    });

    test('orders newest first (ts DESC, id DESC tiebreaker)', async () => {
      await seed(3);
      const { events } = await getMusicEventsPage(db, 'key1', { limit: 10 });
      const ids = events.map((e) => e.id);
      assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    });

    test('filters by eventType when provided', async () => {
      await seed(2, 'label_change');
      await seed(3, 'bpm_update');
      const { events, total } = await getMusicEventsPage(db, 'key1', { limit: 10, eventType: 'bpm_update' });
      assert.equal(total, 3);
      assert.ok(events.every((e) => e.event_type === 'bpm_update'));
    });

    test('only returns events for the requested api_key', async () => {
      await insertMusicEvent(db, 'key1', { event_type: 'label_change', label: 'music' });
      await insertMusicEvent(db, 'key2', { event_type: 'label_change', label: 'speech' });
      const { events, total } = await getMusicEventsPage(db, 'key1', { limit: 10 });
      assert.equal(total, 1);
      assert.equal(events[0].label, 'music');
    });

    test('defaults to limit 50, offset 0 when not provided', async () => {
      await seed(3);
      const { events } = await getMusicEventsPage(db, 'key1');
      assert.equal(events.length, 3);
    });
  });

  describe('enabled config field', () => {
    test('defaults to false when no config row exists', async () => {
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.enabled, false);
    });

    test('round-trips true through setMusicConfig/getMusicConfig', async () => {
      await setMusicConfig(db, 'key1', { enabled: true });
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.enabled, true);
    });

    test('omitted enabled keeps existing value on patch', async () => {
      await setMusicConfig(db, 'key1', { enabled: true });
      await setMusicConfig(db, 'key1', { bpmEnabled: false });
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.enabled, true);
      assert.equal(config.bpmEnabled, false);
    });
  });

  describe('autoStart config field', () => {
    test('defaults to false when no config row exists', async () => {
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.autoStart, false);
    });

    test('round-trips true through setMusicConfig/getMusicConfig', async () => {
      await setMusicConfig(db, 'key1', { autoStart: true });
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.autoStart, true);
    });

    test('requires enabled=true to be effective (checked on publish)', async () => {
      await setMusicConfig(db, 'key1', { autoStart: true, enabled: false });
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.autoStart, true);
      assert.equal(config.enabled, false);
      // The RTMP on_publish hook should check: if (config.enabled && config.autoStart)
    });
  });

  describe('autoCalibrate config field', () => {
    test('defaults to false when no config row exists', async () => {
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.autoCalibrate, false);
    });

    test('round-trips true through setMusicConfig/getMusicConfig', async () => {
      await setMusicConfig(db, 'key1', { autoCalibrate: true });
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.autoCalibrate, true);
    });

    test('omitted autoCalibrate keeps existing value on patch', async () => {
      await setMusicConfig(db, 'key1', { autoCalibrate: true });
      await setMusicConfig(db, 'key1', { bpmEnabled: false });
      const config = await getMusicConfig(db, 'key1');
      assert.equal(config.autoCalibrate, true);
      assert.equal(config.bpmEnabled, false);
    });
  });
});
