/**
 * Perception aggregator (plan_video_perception.md §1 "Output", Phase 2
 * Stream C): turns each per-camera detection POSTed to
 * POST /production/perception/ingest into the two distinct emissions the
 * plan requires — a project-level track_state (the cue engine's existing,
 * previously-inert contract) and a per-camera camera.track_state (feeds
 * World State) — never one raw event per camera onto the cue engine, which
 * would clobber CueEngine._trackerState's one-blob-per-project cache
 * (verified: `Map<apiKey, state>`, `evaluateTrackerEvent()` replaces
 * wholesale — see docs/plans/tmp_plan_video_perception.md's Risk Register).
 *
 * Lives here (the composition root), not in a plugin, because it needs
 * `store` to reach a session's emitter (the only way to fire the cue
 * engine's `track_state` listener — see lcyt-cues's `_attachTrackerListener`)
 * — a cross-plugin dependency only lcyt-backend holds together, the same
 * reasoning caption-fanout.js/caption-file-writer.js already follow.
 */

/**
 * @param {{ store: import('./store.js').SessionStore, eventBus?: object, sceneState?: object }} deps
 */
export function createPerceptionAggregator({ store, eventBus, sceneState }) {
  /** @type {Map<string, Map<string, { labels: object[], visible: boolean, lastSeenAt: number }>>} */
  const byProject = new Map();

  function _projectCameras(apiKey) {
    if (!byProject.has(apiKey)) byProject.set(apiKey, new Map());
    return byProject.get(apiKey);
  }

  function _unionLabels(cameras) {
    const best = new Map(); // label -> highest confidence seen this tick
    for (const cam of cameras.values()) {
      if (!cam.visible) continue;
      for (const l of cam.labels || []) {
        const prev = best.get(l.label);
        if (prev === undefined || (l.confidence || 0) > prev) best.set(l.label, l.confidence || 0);
      }
    }
    return Array.from(best, ([label, confidence]) => ({ label, confidence }));
  }

  /**
   * @param {string} apiKey
   * @param {{ cameraId: string, ts?: number, objects?: Array<{label:string,confidence:number}>, framing?: {score:number}|null, visible?: boolean }} detection
   */
  function ingest(apiKey, detection) {
    const cameraId = String(detection.cameraId);
    const ts = detection.ts || Date.now();
    const objects = detection.objects || [];
    const framing = detection.framing || null;
    const visible = detection.visible !== false;
    const labels = objects.map((o) => ({ label: o.label, confidence: o.confidence }));

    const cameras = _projectCameras(apiKey);
    cameras.set(cameraId, { labels, visible, lastSeenAt: ts });

    // 1. Per-camera detail → World State + camera.track_state. Never
    // touches the cue engine (see module doc).
    if (sceneState) {
      const snapshot = sceneState.getState(apiKey);
      snapshot.cameras[cameraId] = { visible, lastSeenAt: ts, labels, framingScore: framing?.score ?? null };
      snapshot.updatedAt = new Date().toISOString();
    }
    if (eventBus) {
      eventBus.publish(apiKey, 'camera.track_state', { cameraId, ts, labels, visible });
    }

    // 2. Project-level aggregate → the cue engine's existing, previously
    // inert track_state contract (packages/plugins/lcyt-cues/src/cue-processor.js
    // `_attachTrackerListener`): union of labels across every camera
    // currently visible for this project — wholesale replace each tick,
    // matching evaluateTrackerEvent()'s own semantics, not an accumulation.
    const session = store?.getByApiKey?.(apiKey);
    if (session?.emitter) {
      session.emitter.emit('event', { type: 'track_state', data: { labels: _unionLabels(cameras), ts } });
    }
  }

  return { ingest };
}
