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
import { createPerceptionAggregator } from '../src/perception-aggregator.js';

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
      visible: true, lastSeenAt: 500, labels: [{ label: 'person', confidence: 0.8 }], framingScore: 0.6,
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
    assert.deepEqual(published[0].data, { cameraId: 'cam-1', ts: 9, labels: [], visible: false });
  });

  it('does not throw when there is no active session for the apiKey', () => {
    const aggregator = createPerceptionAggregator({ store: makeStore({}) });
    assert.doesNotThrow(() => aggregator.ingest('unknown-key', { cameraId: 'cam-1', objects: [] }));
  });
});
