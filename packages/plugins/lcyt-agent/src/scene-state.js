/**
 * World State / Scene State service (plan_video_perception.md Phase 1 Stream B).
 *
 * Maintains an in-memory, per-project snapshot of the current scene state:
 * - Active speaker (person currently speaking, confidence, camera, timestamp)
 * - Per-camera visibility and framing scores
 * - Segment/scene guess (what's happening, confidence, timestamp)
 * - Last update timestamp
 *
 * Keyed by apiKey for project isolation. Snapshot-only in Phase 1 — history
 * log deferred (plan §2's "append-only history" open question). Updated by
 * handlers wired in Phase 2/3; Phase 1 returns empty/idle state.
 */

/**
 * Create an empty/idle scene state snapshot.
 * @returns {object} SceneState shape per plan_video_perception.md §2
 */
function makeEmptySnapshot() {
  return {
    activeSpeaker: null, // { personId, cameraId, confidence, since }
    cameras: {},         // { [cameraId]: { visible, lastSeenAt, labels, framingScore } }
    segmentGuess: null,  // { label, confidence, since }
    updatedAt: new Date().toISOString(),
  };
}

export class SceneState {
  constructor() {
    /** @type {Map<string, object>} apiKey → current snapshot */
    this._snapshots = new Map();
  }

  /**
   * Get the current scene state snapshot for a project (apiKey).
   * Creates an empty/idle state on first access for that project.
   * @param {string} apiKey
   * @returns {object} SceneState snapshot
   */
  getState(apiKey) {
    if (!this._snapshots.has(apiKey)) {
      this._snapshots.set(apiKey, makeEmptySnapshot());
    }
    return this._snapshots.get(apiKey);
  }

  /**
   * Get the current scene state snapshot for a project (apiKey).
   * Alias for getState() to match the pattern name used in vision-role-manager.js.
   * @param {string} apiKey
   * @returns {object} SceneState snapshot
   */
  status(apiKey) {
    return this.getState(apiKey);
  }

  /**
   * Drop a project's snapshot — for use when the project itself is deleted
   * (code-review fix: `_snapshots` had no eviction at all, so every project
   * that ever ran perception/vision roles would keep a permanent entry for
   * the lifetime of the process). Safe to call even if no snapshot exists.
   * @param {string} apiKey
   */
  clearProject(apiKey) {
    this._snapshots.delete(apiKey);
  }
}
