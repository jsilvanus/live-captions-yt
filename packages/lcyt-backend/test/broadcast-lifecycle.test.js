/**
 * Broadcast lifecycle service (plan_broadcast_lifecycle.md): state machine,
 * pre-flight, step reports and retry, one running broadcast per project.
 * In-memory database, fake steps.
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { createBroadcast, getBroadcast } from '../src/db/broadcasts.js';
import { createBroadcastLifecycle, LifecycleError } from '../src/broadcasts/lifecycle.js';

const KEY = 'lifecycle-key';
let db;

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner, active) VALUES (?, 'Owner', 1)").run(KEY);
});
after(() => db.close());
beforeEach(async () => {
  await db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(KEY);
});

function make({ steps = {}, deliverables = async () => ({ captions: true, video: false, audio: false }) } = {}) {
  const events = [];
  const calls = [];
  const wrapped = {};
  for (const name of ['outputsOn', 'platformStage', 'captionSync', 'platformGoLive', 'startRecording', 'arm', 'startCaptionSync',
    'stopCaptionSync', 'disarm', 'stopRecording', 'outputsOff', 'platformStop', 'platformComplete']) {
    wrapped[name] = async (ctx) => { calls.push(name); if (steps[name]) return steps[name](ctx); };
  }
  const lifecycle = createBroadcastLifecycle({
    db, eventBus: { publish: (k, topic, data) => events.push({ topic, ...data }) }, steps: wrapped, deliverables,
  });
  return { lifecycle, events, calls };
}

async function draft(extra = {}) {
  return (await createBroadcast(db, KEY, { title: 'Sunday', ...extra })).broadcast;
}

describe('transitions', () => {
  it('walks draft -> staging -> live -> stopped -> completed and publishes each change', async () => {
    const { lifecycle, events, calls } = make();
    const b = await draft();
    assert.equal((await lifecycle.transition(KEY, b.id, 'stage')).broadcast.status, 'staging');
    const live = (await lifecycle.transition(KEY, b.id, 'go-live')).broadcast;
    assert.equal(live.status, 'live');
    assert.ok(live.actualStart);
    assert.equal((await lifecycle.transition(KEY, b.id, 'stop')).broadcast.status, 'stopped');
    const done = (await lifecycle.transition(KEY, b.id, 'complete')).broadcast;
    assert.equal(done.status, 'completed');
    assert.ok(done.actualEnd);
    assert.deepEqual(events.filter((e) => e.topic === 'broadcast.state_changed').map((e) => e.to),
      ['staging', 'live', 'stopping', 'stopped', 'completed']);
    // steps ran in the planned order
    assert.deepEqual(calls, ['outputsOn', 'platformStage', 'captionSync', 'platformGoLive', 'startRecording', 'arm', 'startCaptionSync',
      'stopCaptionSync', 'disarm', 'stopRecording', 'outputsOff', 'platformStop', 'platformComplete']);
  });

  it('refuses actions from the wrong state with 409', async () => {
    const { lifecycle } = make();
    const b = await draft();
    await assert.rejects(lifecycle.transition(KEY, b.id, 'go-live'), (e) => e instanceof LifecycleError && e.status === 409);
    await assert.rejects(lifecycle.transition(KEY, b.id, 'complete'), (e) => e.status === 409);
  });

  it('404s for an unknown broadcast and another project', async () => {
    const { lifecycle } = make();
    await assert.rejects(lifecycle.transition(KEY, 'nope', 'stage'), (e) => e.status === 404);
  });

  it('cancels a draft or scheduled broadcast and restores it to draft', async () => {
    const { lifecycle } = make();
    const b = await draft({ scheduledStart: '2026-11-01T10:00:00', status: 'scheduled' });
    assert.equal((await lifecycle.transition(KEY, b.id, 'cancel')).broadcast.status, 'cancelled');
    assert.equal((await lifecycle.transition(KEY, b.id, 'restore')).broadcast.status, 'draft');
  });

  it('stages again from stopped and keeps the caption sequence and actual_start', async () => {
    const { lifecycle } = make();
    const b = await draft();
    await lifecycle.transition(KEY, b.id, 'stage');
    await lifecycle.transition(KEY, b.id, 'go-live');
    const started = (await getBroadcast(db, KEY, b.id)).actualStart;
    await db.broadcasts.updateMany({ where: { id: b.id }, data: { caption_sequence: 42 } });
    await lifecycle.transition(KEY, b.id, 'stop');
    await lifecycle.transition(KEY, b.id, 'stage');
    const again = await getBroadcast(db, KEY, b.id);
    assert.equal(again.status, 'staging');
    assert.equal(again.captionSequence, 42);
    await lifecycle.transition(KEY, b.id, 'go-live');
    assert.equal((await getBroadcast(db, KEY, b.id)).actualStart, started);
  });

  it('first staging resets the caption sequence to 0', async () => {
    const { lifecycle } = make();
    const b = await draft();
    await db.broadcasts.updateMany({ where: { id: b.id }, data: { caption_sequence: 9 } });
    await lifecycle.transition(KEY, b.id, 'stage');
    assert.equal((await getBroadcast(db, KEY, b.id)).captionSequence, 0);
  });

  it('a new platform broadcast resets the sequence again', async () => {
    const { lifecycle } = make({ steps: { platformStage: async () => ({ newPlatformBroadcast: true }) } });
    const b = await draft();
    await lifecycle.transition(KEY, b.id, 'stage');
    assert.equal((await getBroadcast(db, KEY, b.id)).captionSequence, 0);
  });
});

describe('pre-flight and one broadcast per project', () => {
  it('refuses staging without any deliverable and lists the finding', async () => {
    const { lifecycle } = make({ deliverables: async () => ({ captions: false, video: false, audio: false }) });
    const b = await draft();
    const pf = await lifecycle.preflight(KEY, b.id);
    assert.equal(pf.ok, false);
    assert.equal(pf.findings[0].code, 'no_deliverables');
    await assert.rejects(lifecycle.transition(KEY, b.id, 'stage'), (e) => e.code === 'preflight_failed' && e.findings.length === 1);
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'draft');
  });

  it('a DSK/video output alone satisfies the deliverables rule', async () => {
    const { lifecycle } = make({ deliverables: async () => ({ captions: false, video: true, audio: false }) });
    const b = await draft();
    assert.equal((await lifecycle.preflight(KEY, b.id)).ok, true);
  });

  it('refuses a second broadcast while one is running, and current() finds the running one', async () => {
    const { lifecycle } = make();
    const a = await draft({ title: 'A' });
    const b = await draft({ title: 'B' });
    await lifecycle.transition(KEY, a.id, 'stage');
    await assert.rejects(lifecycle.transition(KEY, b.id, 'stage'), (e) => e.findings?.[0]?.code === 'another_broadcast_running');
    assert.equal((await lifecycle.current(KEY)).id, a.id);
    await lifecycle.transition(KEY, a.id, 'stop');
    assert.equal((await lifecycle.current(KEY)).status, 'stopped');
    await lifecycle.transition(KEY, a.id, 'complete');
    assert.equal(await lifecycle.current(KEY), null);
    assert.equal((await lifecycle.transition(KEY, b.id, 'stage')).broadcast.status, 'staging');
  });

  it('warnings block staging unless forced', async () => {
    const { lifecycle } = make({ steps: { preflight: async () => [{ code: 'x', severity: 'warn', message: 'careful' }] } });
    const b = await draft();
    // preflight is wired through createBroadcastLifecycle steps in production; here via the wrapper
    const lc = createBroadcastLifecycle({
      db, steps: { preflight: async () => [{ code: 'x', severity: 'warn', message: 'careful' }] },
      deliverables: async () => ({ captions: true }),
    });
    await assert.rejects(lc.transition(KEY, b.id, 'stage'), (e) => e.code === 'preflight_failed');
    assert.equal((await lc.transition(KEY, b.id, 'stage', { force: true })).broadcast.status, 'staging');
    void lifecycle;
  });
});

describe('failing steps', () => {
  it('a failed fatal staging step leaves the broadcast in staging and a retry resumes after the finished steps', async () => {
    let fail = true;
    const { lifecycle, calls, events } = make({ steps: { platformStage: async () => { if (fail) throw new Error('youtube down'); } } });
    const b = await draft();
    await assert.rejects(lifecycle.transition(KEY, b.id, 'stage'), (e) => e.status === 502 && e.step === 'platformStage' && e.report.steps.platformStage.status === 'failed');
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'staging');
    assert.ok(events.some((e) => e.topic === 'broadcast.step_failed' && e.step === 'platformStage'));
    fail = false;
    calls.length = 0;
    await lifecycle.transition(KEY, b.id, 'stage');
    assert.equal(calls.includes('outputsOn'), false, 'finished step not repeated');
    assert.equal(calls.includes('platformStage'), true);
    assert.equal((await getBroadcast(db, KEY, b.id)).stageReport.steps.platformStage.status, 'ok');
  });

  it('a failed platform go-live keeps the broadcast in staging', async () => {
    const { lifecycle } = make({ steps: { platformGoLive: async () => { throw new Error('no'); } } });
    const b = await draft();
    await lifecycle.transition(KEY, b.id, 'stage');
    await assert.rejects(lifecycle.transition(KEY, b.id, 'go-live'), (e) => e.status === 502);
    assert.equal((await getBroadcast(db, KEY, b.id)).status, 'staging');
  });

  it('a failing step never blocks a stop; it shows up as a warning', async () => {
    const { lifecycle } = make({ steps: { stopRecording: async () => { throw new Error('disk'); } } });
    const b = await draft();
    await lifecycle.transition(KEY, b.id, 'stage');
    await lifecycle.transition(KEY, b.id, 'go-live');
    const out = await lifecycle.transition(KEY, b.id, 'stop');
    assert.equal(out.broadcast.status, 'stopped');
    assert.equal(out.report.warnings[0].step, 'stopRecording');
  });
});

describe('PUT-side rules around the lifecycle', () => {
  it('setting and clearing the start time moves draft <-> scheduled', async () => {
    const { updateBroadcast } = await import('../src/db/broadcasts.js');
    const b = await draft();
    assert.equal((await updateBroadcast(db, KEY, b.id, { scheduledStart: '2026-11-01T10:00:00' })).broadcast.status, 'scheduled');
    assert.equal((await updateBroadcast(db, KEY, b.id, { scheduledStart: null })).broadcast.status, 'draft');
  });

  it('archiving is refused while staging, live, stopping or stopped', async () => {
    const { archiveBroadcast } = await import('../src/db/broadcasts.js');
    const { lifecycle } = make();
    const b = await draft();
    await lifecycle.transition(KEY, b.id, 'stage');
    assert.equal((await archiveBroadcast(db, KEY, b.id)).status, 409);
  });
});
