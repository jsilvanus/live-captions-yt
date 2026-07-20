/**
 * Unit tests for SceneState (plan_video_perception.md Phase 1 Stream B).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SceneState } from '../src/scene-state.js';

describe('SceneState', () => {
  afterEach(() => {
    // Reset the singleton for each test
  });

  it('returns an empty/idle snapshot on first access for a project', () => {
    const state = new SceneState();
    const snapshot = state.getState('proj-a');

    assert.equal(snapshot.activeSpeaker, null);
    assert.deepEqual(snapshot.cameras, {});
    assert.equal(snapshot.segmentGuess, null);
    assert.ok(snapshot.updatedAt); // ISO string
  });

  it('status() is an alias for getState()', () => {
    const state = new SceneState();
    const snapshot1 = state.getState('proj-b');
    const snapshot2 = state.status('proj-b');

    assert.deepEqual(snapshot1, snapshot2);
  });

  it('isolates state between different apiKeys — mutations do not leak', () => {
    const state = new SceneState();

    const snapA = state.getState('proj-a');
    const snapB = state.getState('proj-b');

    // Mutate project A's state directly (not a public API, but proves isolation)
    snapA.activeSpeaker = { personId: 'person-1', cameraId: 'cam-1', confidence: 0.95, since: Date.now() };

    // Project B should still have null activeSpeaker
    const snapBAfter = state.status('proj-b');
    assert.equal(snapBAfter.activeSpeaker, null);

    // Verify project A kept its mutation
    const snapAAfter = state.status('proj-a');
    assert.ok(snapAAfter.activeSpeaker);
    assert.equal(snapAAfter.activeSpeaker.personId, 'person-1');
  });

  it('shape matches the plan_video_perception.md §2 spec', () => {
    const state = new SceneState();
    const snapshot = state.getState('proj-test');

    // Verify the spec shape
    assert.ok('activeSpeaker' in snapshot);
    assert.ok('cameras' in snapshot);
    assert.ok('segmentGuess' in snapshot);
    assert.ok('updatedAt' in snapshot);

    // activeSpeaker and segmentGuess start null
    assert.equal(snapshot.activeSpeaker, null);
    assert.equal(snapshot.segmentGuess, null);

    // cameras is an empty object
    assert.deepEqual(snapshot.cameras, {});

    // updatedAt is present and is a string (ISO format)
    assert.equal(typeof snapshot.updatedAt, 'string');
  });
});
