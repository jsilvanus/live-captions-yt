import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from 'lcyt/event-bus';
import { initDb } from '../src/db.js';
import {
  isAuditableTopic,
  insertBusEvent,
  deleteBusEventsOlderThan,
  listBusEvents,
  attachBusAuditLog,
} from '../src/db/bus-events.js';

let db;
beforeEach(() => { db = initDb(':memory:'); });

describe('isAuditableTopic (curated allowlist)', () => {
  it('logs governance + low-frequency config topics', () => {
    assert.equal(isAuditableTopic('role.assistant.assistant_action'), true);
    assert.equal(isAuditableTopic('role.assistant.assistant_suggestion'), true);
    assert.equal(isAuditableTopic('cue.fired'), true);
    assert.equal(isAuditableTopic('dsk.graphics_changed'), true);
    assert.equal(isAuditableTopic('target.created'), true); // target.* prefix
    assert.equal(isAuditableTopic('translation.updated'), true); // translation.* prefix
  });

  it('excludes high-frequency topics', () => {
    assert.equal(isAuditableTopic('caption.sent'), false);
    assert.equal(isAuditableTopic('session.mic_state'), false);
    assert.equal(isAuditableTopic('dsk.text'), false);
    assert.equal(isAuditableTopic('variable.updated'), false);
    assert.equal(isAuditableTopic('stt.transcript'), false);
  });
});

describe('attachBusAuditLog', () => {
  it('persists only curated topics from bus publishes', () => {
    const bus = new EventBus();
    attachBusAuditLog(bus, db);

    bus.publish('p1', 'cue.fired', { id: 7 });
    bus.publish('p1', 'caption.sent', { requestId: 'r1' }); // high-frequency, skipped
    bus.publish('p2', 'dsk.graphics_changed', { layers: ['a'] });

    const rows = listBusEvents(db);
    assert.equal(rows.length, 2);
    const byTopic = Object.fromEntries(rows.map((r) => [r.topic, r]));
    assert.ok(byTopic['cue.fired']);
    assert.equal(byTopic['cue.fired'].project_id, 'p1');
    assert.deepEqual(byTopic['cue.fired'].payload, { id: 7 });
    assert.ok(byTopic['dsk.graphics_changed']);
    assert.equal(byTopic['caption.sent'], undefined);
  });

  it('unregister stops logging', () => {
    const bus = new EventBus();
    const off = attachBusAuditLog(bus, db);
    bus.publish('p1', 'cue.fired', {});
    off();
    bus.publish('p1', 'cue.fired', {});
    assert.equal(listBusEvents(db).length, 1);
  });
});

describe('bus_events retention', () => {
  it('deleteBusEventsOlderThan purges rows past the cutoff, keeps recent', () => {
    const now = Date.now();
    insertBusEvent(db, { projectId: 'p1', topic: 'cue.fired', ts: now - 40 * 86_400_000, payload: { old: true } });
    insertBusEvent(db, { projectId: 'p1', topic: 'cue.fired', ts: now - 1 * 86_400_000, payload: { old: false } });

    const { count } = deleteBusEventsOlderThan(db, 30);
    assert.equal(count, 1);

    const rows = listBusEvents(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.old, false);
  });
});
