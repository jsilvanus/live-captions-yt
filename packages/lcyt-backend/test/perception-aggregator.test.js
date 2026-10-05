/**
 * Tests for createPerceptionAggregator (plan_video_perception.md Phase 2
 * Stream C): per-camera detections fan into (1) a project-level track_state
 * event on the session emitter (the cue engine's existing contract) and
 * (2) per-camera camera.track_state on the EventBus + a SceneState update —
 * never a raw per-camera event onto the cue engine.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPerceptionAggregator, regionOf } from '../src/perception-aggregator.js';

function makeStore(sessionsByApiKey) {
  return { getByApiKey: (apiKey) => sessionsByApiKey[apiKey] || null };
}

function makeSceneState() {
  const snapshots = new Map();
  return {
    getState(apiKey) {
      if (!snapshots.has(apiKey)) snapshots.set(apiKey, { activeSpeaker: null, cameras: {}, segmentGuess: null, updatedAt: null });
      return snapshots.get(apiKey);
    },
  };
}

describe('createPerceptionAggregator', () => {
  it('emits a project-level track_state event on the session emitter', () => {
    const emitter = new EventEmitter();
    const store = makeStore({ key1: { apiKey: 'key1', emitter } });
    const aggregator = createPerceptionAggregator({ store });

    const events = [];
    emitter.on('event', (evt) => events.push(evt));

    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 1000, objects: [{ label: 'person', confidence: 0.9 }], visible: true });

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'track_state');
    assert.deepEqual(events[0].data, { labels: [{ label: 'person', confidence: 0.9 }], ts: 1000 });
  });

  it('unions labels across every currently-visible camera, wholesale-replacing each tick', () => {
    const emitter = new EventEmitter();
    const store = makeStore({ key1: { apiKey: 'key1', emitter } });
    const aggregator = createPerceptionAggregator({ store });
    const events = [];
    emitter.on('event', (evt) => events.push(evt));

    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 1, objects: [{ label: 'person', confidence: 0.5 }], visible: true });
    aggregator.ingest('key1', { cameraId: 'cam-2', ts: 2, objects: [{ label: 'choir', confidence: 0.7 }], visible: true });

    // Second tick's union must still include camera 1's label — a naive
    // per-camera emission would have camera 2's tick clobber camera 1's
    // contribution (the exact bug the module doc warns against).
    const last = events[events.length - 1].data.labels;
    const byLabel = Object.fromEntries(last.map((l) => [l.label, l.confidence]));
    assert.deepEqual(byLabel, { person: 0.5, choir: 0.7 });
  });

  it('excludes a camera from the union once it reports visible: false', () => {
    const emitter = new EventEmitter();
    const store = makeStore({ key1: { apiKey: 'key1', emitter } });
    const aggregator = createPerceptionAggregator({ store });
    const events = [];
    emitter.on('event', (evt) => events.push(evt));

    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 1, objects: [{ label: 'person', confidence: 0.5 }], visible: true });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 2, objects: [], visible: false });

    assert.deepEqual(events[events.length - 1].data.labels, []);
  });

  it('updates SceneState with per-camera visibility/labels/framing and bumps updatedAt', () => {
    const sceneState = makeSceneState();
    const aggregator = createPerceptionAggregator({ store: makeStore({}), sceneState });

    aggregator.ingest('key1', {
      cameraId: 'cam-1', ts: 500, objects: [{ label: 'person', confidence: 0.8 }],
      framing: { score: 0.6 }, visible: true,
    });

    const snapshot = sceneState.getState('key1');
    assert.deepEqual(snapshot.cameras['cam-1'], {
      visible: true, lastSeenAt: 500, labels: [{ label: 'person', confidence: 0.8 }], framingScore: 0.6, framingNotes: null, subjects: [],
    });
    assert.ok(snapshot.updatedAt);
  });

  it('publishes camera.track_state on the EventBus for every ingest, regardless of session presence', () => {
    const published = [];
    const eventBus = { publish: (apiKey, topic, data) => published.push({ apiKey, topic, data }) };
    const aggregator = createPerceptionAggregator({ store: makeStore({}), eventBus });

    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 9, objects: [], visible: false });

    assert.equal(published.length, 1);
    assert.equal(published[0].topic, 'camera.track_state');
    assert.deepEqual(published[0].data, { cameraId: 'cam-1', ts: 9, labels: [], visible: false, subjects: [], framing: null });
  });

  it('does not throw when there is no active session for the apiKey', () => {
    const aggregator = createPerceptionAggregator({ store: makeStore({}) });
    assert.doesNotThrow(() => aggregator.ingest('unknown-key', { cameraId: 'cam-1', objects: [] }));
  });

  it('clearProject() drops a project\'s tracked cameras, so a later ingest re-starts a clean union (code-review fix)', () => {
    const emitter = new EventEmitter();
    const store = makeStore({ 'proj-a': { apiKey: 'proj-a', emitter } });
    const aggregator = createPerceptionAggregator({ store });
    const events = [];
    emitter.on('event', (evt) => events.push(evt));

    aggregator.ingest('proj-a', { cameraId: 'cam-1', ts: 1, objects: [{ label: 'person', confidence: 0.5 }], visible: true });
    aggregator.clearProject('proj-a');

    // A camera that isn't re-reported after the clear must not linger in
    // the union — proving the tracked-cameras Map was actually emptied,
    // not just left stale until the next update for that same camera.
    aggregator.ingest('proj-a', { cameraId: 'cam-2', ts: 2, objects: [{ label: 'choir', confidence: 0.7 }], visible: true });
    const last = events[events.length - 1].data.labels;
    assert.deepEqual(last, [{ label: 'choir', confidence: 0.7 }]);
  });

  it('clearProject() is a safe no-op for a project with no tracked cameras', () => {
    const aggregator = createPerceptionAggregator({ store: makeStore({}) });
    assert.doesNotThrow(() => aggregator.clearProject('never-existed'));
  });
});

describe('perception aggregator: boxes, regions and ordering (contract v2)', () => {
  const person = (x, id, conf = 0.9) => ({ label: 'person', confidence: conf, trackId: id, id, bbox: { x, y: 0.2, w: 0.2, h: 0.6 } });

  it('regionOf names the horizontal and vertical third of the box centre', () => {
    assert.deepEqual(regionOf({ x: 0, y: 0, w: 0.2, h: 0.2 }), { zone: 'left', vertical: 'top', x: 0, y: 0, w: 0.2, h: 0.2 });
    assert.equal(regionOf({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }).zone, 'center');
    assert.equal(regionOf({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }).vertical, 'middle');
    assert.equal(regionOf({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 }).zone, 'right');
    assert.equal(regionOf({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 }).vertical, 'bottom');
  });

  it('track_state labels carry a region, one entry per label and zone', () => {
    const emitter = new EventEmitter();
    const aggregator = createPerceptionAggregator({ store: makeStore({ key1: { apiKey: 'key1', emitter } }) });
    const events = [];
    emitter.on('event', (e) => events.push(e));
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 1, objects: [person(0.0, 't1', 0.7), person(0.1, 't2', 0.9), person(0.75, 't3', 0.8)], visible: true });
    const labels = events[0].data.labels;
    assert.equal(labels.length, 2); // left (two people, best kept) and right
    const left = labels.find((l) => l.region.zone === 'left');
    assert.equal(left.confidence, 0.9);
    assert.equal(labels.find((l) => l.region.zone === 'right').confidence, 0.8);
  });

  it('World State gets subjects with track ids and the framing score and notes', () => {
    const sceneState = makeSceneState();
    const aggregator = createPerceptionAggregator({ store: makeStore({}), sceneState });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 5, objects: [person(0.4, 't1')], framing: { score: 0.8, notes: 'subject small in frame' }, visible: true });
    const cam = sceneState.getState('key1').cameras['cam-1'];
    assert.equal(cam.framingScore, 0.8);
    assert.equal(cam.framingNotes, 'subject small in frame');
    assert.deepEqual(cam.subjects, [{ trackId: 't1', label: 'person', confidence: 0.9, bbox: { x: 0.4, y: 0.2, w: 0.2, h: 0.6 } }]);
  });

  it('camera.track_state includes subjects and framing; its labels stay plain', () => {
    const published = [];
    const aggregator = createPerceptionAggregator({ store: makeStore({}), eventBus: { publish: (...a) => published.push(a) } });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 5, objects: [person(0.4, 't1')], framing: { score: 0.8 }, visible: true });
    const [, topic, payload] = published[0];
    assert.equal(topic, 'camera.track_state');
    assert.deepEqual(payload.labels, [{ label: 'person', confidence: 0.9 }]);
    assert.equal(payload.subjects[0].trackId, 't1');
    assert.deepEqual(payload.framing, { score: 0.8 });
  });

  it('a detection captured before the last one seen is dropped', () => {
    const sceneState = makeSceneState();
    const aggregator = createPerceptionAggregator({ store: makeStore({}), sceneState });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 10, capturedAt: 1000, objects: [person(0.4, 't1')], visible: true });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 11, capturedAt: 900, objects: [], visible: true }); // late, older frame
    assert.equal(sceneState.getState('key1').cameras['cam-1'].subjects.length, 1);
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 12, capturedAt: 1100, objects: [], visible: true });
    assert.equal(sceneState.getState('key1').cameras['cam-1'].subjects.length, 0);
  });

  it('detections without capturedAt (older jobs) are never dropped', () => {
    const sceneState = makeSceneState();
    const aggregator = createPerceptionAggregator({ store: makeStore({}), sceneState });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 10, objects: [person(0.4, 't1')], visible: true });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 9, objects: [], visible: true });
    assert.equal(sceneState.getState('key1').cameras['cam-1'].subjects.length, 0);
  });
  it('sweeper marks a camera that stopped reporting as not visible, once, and clears the cue union', () => {
    let clock = 1000;
    const published = [];
    const events = [];
    const store = { getByApiKey: () => ({ emitter: { emit: (_n, e) => events.push(e) } }) };
    const sceneState = makeSceneState();
    const aggregator = createPerceptionAggregator({
      store, sceneState, staleMs: 5000, now: () => clock, eventBus: { publish: (...a) => published.push(a) },
    });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: clock, objects: [person(0.4, 't1')], visible: true });
    clock = 4000;
    assert.equal(aggregator.sweep(), 0); // still fresh
    clock = 7000;
    assert.equal(aggregator.sweep(), 1); // 6 s of silence
    assert.equal(sceneState.getState('key1').cameras['cam-1'].visible, false);
    const last = published.filter((e) => e[1] === 'camera.track_state').pop();
    assert.equal(last[2].visible, false);
    assert.equal(last[2].stale, true);
    assert.deepEqual(events[events.length - 1].data.labels, []);
    clock = 20000;
    assert.equal(aggregator.sweep(), 0); // already not visible
  });

  it('a camera that keeps reporting is never swept', () => {
    let clock = 0;
    const aggregator = createPerceptionAggregator({ store: makeStore({}), staleMs: 1000, now: () => clock });
    for (let i = 0; i < 5; i++) {
      clock += 800;
      aggregator.ingest('key1', { cameraId: 'cam-1', ts: clock, objects: [], visible: true });
      assert.equal(aggregator.sweep(), 0);
    }
  });
  it('publishes perception.interest when a person enters, and person_left when the camera goes silent', () => {
    let clock = 0;
    const published = [];
    const aggregator = createPerceptionAggregator({ store: makeStore({}), staleMs: 1000, now: () => clock, eventBus: { publish: (...a) => published.push(a) } });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 10, objects: [person(0.4, 't1')], visible: true });
    const interest = () => published.filter((e) => e[1] === 'perception.interest').map((e) => `${e[2].kind}:${e[2].cameraId}:${e[2].trackId}`);
    assert.deepEqual(interest(), ['person_entered:cam-1:t1']);
    clock = 5000; aggregator.sweep();
    assert.deepEqual(interest(), ['person_entered:cam-1:t1', 'person_left:cam-1:t1']);
  });

  it('labelTrack binds a role to a track: subject role, cue label at its place, dropped when the track is gone', () => {
    const sceneState = makeSceneState();
    const events = [];
    const store = { getByApiKey: () => ({ emitter: { emit: (_n, e) => events.push(e) } }) };
    const aggregator = createPerceptionAggregator({ store, sceneState });
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 1, objects: [person(0.1, 't1'), person(0.8, 't2')], visible: true });
    assert.equal(aggregator.labelTrack('key1', 'cam-1', 't1', 'preacher', 0.9), true);
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 2, objects: [person(0.1, 't1'), person(0.8, 't2')], visible: true });
    const subjects = sceneState.getState('key1').cameras['cam-1'].subjects;
    assert.equal(subjects.find((s) => s.trackId === 't1').role, 'preacher');
    assert.equal(subjects.find((s) => s.trackId === 't2').role, undefined);
    const union = events[events.length - 1].data.labels;
    assert.ok(union.some((l) => l.label === 'preacher' && l.region.zone === 'left'));
    assert.ok(union.some((l) => l.label === 'person' && l.region.zone === 'right'));
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 3, objects: [person(0.8, 't2')], visible: true }); // t1 gone
    aggregator.ingest('key1', { cameraId: 'cam-1', ts: 4, objects: [person(0.1, 't1')], visible: true }); // a new t1? same id, role must not return
    assert.equal(sceneState.getState('key1').cameras['cam-1'].subjects[0].role, undefined);
    assert.equal(aggregator.labelTrack('key1', 'cam-1', null, 'x'), false);
  });
});
