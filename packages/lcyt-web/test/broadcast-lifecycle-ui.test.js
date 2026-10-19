import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, pickUpcoming, canForce } from '../src/lib/broadcast-lifecycle-ui.js';

describe('actionsFor', () => {
  it('offers the next step per status', () => {
    assert.deepEqual(actionsFor('draft').map((a) => a.action), ['stage', 'cancel']);
    assert.deepEqual(actionsFor('staging').map((a) => a.action), ['go-live', 'stage', 'stop']);
    assert.deepEqual(actionsFor('live').map((a) => a.action), ['stop']);
    assert.deepEqual(actionsFor('stopped').map((a) => a.action), ['stage', 'complete']);
    assert.deepEqual(actionsFor('cancelled').map((a) => a.action), ['restore']);
    assert.deepEqual(actionsFor('completed'), []);
  });
});

describe('pickUpcoming', () => {
  const now = Date.parse('2026-10-25T10:00:00Z');
  it('takes the one scheduled nearest to now, within the window', () => {
    const list = [
      { id: 'a', status: 'scheduled', scheduledStart: '2026-10-25T09:00:00Z' },
      { id: 'b', status: 'scheduled', scheduledStart: '2026-10-25T10:30:00Z' },
      { id: 'c', status: 'scheduled', scheduledStart: '2026-11-01T10:00:00Z' },
    ];
    assert.equal(pickUpcoming(list, now).id, 'b');
  });
  it('falls back to a draft without a time, and to null', () => {
    assert.equal(pickUpcoming([{ id: 'd', status: 'draft' }], now).id, 'd');
    assert.equal(pickUpcoming([{ id: 'c', status: 'scheduled', scheduledStart: '2026-11-01T10:00:00Z' }], now), null);
    assert.equal(pickUpcoming([{ id: 'x', status: 'live' }], now), null);
  });
});

describe('canForce', () => {
  it('only when every finding is a warning', () => {
    assert.equal(canForce([{ severity: 'warn' }]), true);
    assert.equal(canForce([{ severity: 'warn' }, { severity: 'error' }]), false);
    assert.equal(canForce([]), false);
  });
});
