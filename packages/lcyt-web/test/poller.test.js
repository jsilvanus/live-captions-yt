import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller, STOP_POLLING } from '../src/lib/poller.js';

function harness(overrides = {}) {
  const timers = [];
  const state = { hidden: false, listeners: new Set() };
  const opts = {
    intervalMs: 1000,
    isHidden: () => state.hidden,
    onVisibilityChange: (cb) => { state.listeners.add(cb); return () => state.listeners.delete(cb); },
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    ...overrides,
  };
  const pending = () => timers.filter((t) => t.live);
  const fire = async () => { const t = pending().at(-1); t.live = false; await t.fn(); await Promise.resolve(); };
  const setHidden = (h) => { state.hidden = h; state.listeners.forEach((cb) => cb()); };
  return { opts, pending, fire, setHidden, state };
}
const settle = () => new Promise((r) => setImmediate(r));

test('runs immediately, then reschedules after each run', async () => {
  let n = 0;
  const h = harness();
  const p = createPoller({ ...h.opts, task: () => { n += 1; } });
  p.start();
  await settle();
  assert.equal(n, 1);
  assert.equal(h.pending().length, 1);
  assert.equal(h.pending()[0].ms, 1000);
  await h.fire(); await settle();
  assert.equal(n, 2);
  p.stop();
  assert.equal(h.pending().length, 0);
});

test('pauses while hidden and runs once on becoming visible', async () => {
  let n = 0; let t = 0;
  const h = harness();
  const p = createPoller({ ...h.opts, now: () => t, random: () => 0, task: () => { n += 1; } });
  p.start(); await settle();
  h.setHidden(true);
  assert.equal(h.pending().length, 0);
  t = 5000;
  h.setHidden(false);
  await h.fire(); await settle();
  assert.equal(n, 2);
  assert.equal(h.pending().length, 1);
  p.stop();
});

test('does not run at all when started hidden', async () => {
  let n = 0;
  const h = harness();
  h.state.hidden = true;
  const p = createPoller({ ...h.opts, task: () => { n += 1; } });
  p.start(); await settle();
  assert.equal(n, 0);
  assert.equal(h.pending().length, 0);
  p.stop();
});

test('backs off on failures (capped) and resets on success', async () => {
  let fail = true;
  const h = harness();
  const p = createPoller({ ...h.opts, maxBackoff: 4, task: () => { if (fail) throw new Error('x'); } });
  p.start(); await settle();
  assert.equal(h.pending()[0].ms, 2000);
  await h.fire(); await settle();
  assert.equal(h.pending().at(-1).ms, 4000);
  await h.fire(); await settle();
  assert.equal(h.pending().at(-1).ms, 4000);
  fail = false;
  await h.fire(); await settle();
  assert.equal(h.pending().at(-1).ms, 1000);
  p.stop();
});

test('stops for good on a 401 error', async () => {
  let n = 0;
  const h = harness();
  const p = createPoller({ ...h.opts, task: () => { n += 1; throw Object.assign(new Error('no'), { status: 401 }); } });
  p.start(); await settle();
  assert.equal(n, 1);
  assert.equal(p.stopped, true);
  assert.equal(h.pending().length, 0);
  assert.equal(h.state.listeners.size, 0);
});

test('stops when the task returns STOP_POLLING', async () => {
  const h = harness();
  const p = createPoller({ ...h.opts, task: () => STOP_POLLING });
  p.start(); await settle();
  assert.equal(p.stopped, true);
  assert.equal(h.pending().length, 0);
});

test('never overlaps runs', async () => {
  let active = 0; let max = 0; let release;
  const h = harness();
  const p = createPoller({ ...h.opts, task: async () => {
    active += 1; max = Math.max(max, active);
    await new Promise((r) => { release = r; });
    active -= 1;
  } });
  p.start(); await settle();
  h.setHidden(true); h.setHidden(false); await settle();
  assert.equal(max, 1);
  release(); await settle();
  p.stop();
});

test('401: keeps polling when onUnauthorized renews the credentials', async () => {
  let n = 0;
  const h = harness();
  const p = createPoller({ ...h.opts, onUnauthorized: async () => true, task: () => { n += 1; if (n === 1) throw Object.assign(new Error('no'), { status: 401 }); } });
  p.start(); await settle();
  assert.equal(p.stopped, false);
  assert.equal(h.pending().length, 1);
  await h.fire(); await settle();
  assert.equal(n, 2);
  p.stop();
});

test('401: stops when onUnauthorized does not renew', async () => {
  const h = harness();
  const p = createPoller({ ...h.opts, onUnauthorized: async () => false, task: () => { throw Object.assign(new Error('no'), { status: 401 }); } });
  p.start(); await settle();
  assert.equal(p.stopped, true);
});

test('resume: recent data is kept, refetch waits for the interval', async () => {
  let n = 0; let t = 0;
  const h = harness({ now: () => t });
  const p = createPoller({ ...h.opts, now: () => t, task: () => { n += 1; } });
  p.start(); await settle();
  t = 300;
  h.setHidden(true); h.setHidden(false); await settle();
  assert.equal(n, 1);
  assert.equal(h.pending().at(-1).ms, 700);
  p.stop();
});

test('resume: stale data refetches once after a jitter', async () => {
  let n = 0; let t = 0;
  const h = harness();
  const p = createPoller({ ...h.opts, now: () => t, random: () => 0.5, resumeJitterMs: 600, task: () => { n += 1; } });
  p.start(); await settle();
  t = 60_000;
  h.setHidden(true); h.setHidden(false);
  assert.equal(n, 1);
  assert.equal(h.pending().at(-1).ms, 300);
  await h.fire(); await settle();
  assert.equal(n, 2);
  p.stop();
});
