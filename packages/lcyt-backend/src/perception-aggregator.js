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
 * Coarse place of a normalised box in the picture, from its centre: `zone` is left / center / right
 * thirds, `vertical` is top / middle / bottom thirds. Cue rules can match it with `label@zone`.
 * @param {{ x: number, y: number, w: number, h: number }} bbox
 */
export function regionOf(bbox) {
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const third = (v, names) => (v < 1 / 3 ? names[0] : v > 2 / 3 ? names[2] : names[1]);
  return { zone: third(cx, ['left', 'center', 'right']), vertical: third(cy, ['top', 'middle', 'bottom']), x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h };
}

/**
 * @param {{ store: import('./store.js').SessionStore, eventBus?: object, sceneState?: object }} deps
 */
export function createPerceptionAggregator({ store, eventBus, sceneState }) {
  /** @type {Map<string, Map<string, { labels: object[], visible: boolean, lastSeenAt: number, capturedAt: number }>>} */
  const byProject = new Map();

  function _projectCameras(apiKey) {
    if (!byProject.has(apiKey)) byProject.set(apiKey, new Map());
    return byProject.get(apiKey);
  }

  // One entry per label and zone: a label seen in two places stays two entries, so `person@left` and
  // `person@right` rules each see theirs, while a plain `person` rule matches either. Labels without a
  // box (no region) collapse to one entry per label, as before.
  function _unionLabels(cameras) {
    const best = new Map(); // label + zone -> entry with the highest confidence seen this tick
    for (const cam of cameras.values()) {
      if (!cam.visible) continue;
      for (const l of cam.labels || []) {
        const key = l.region ? `${l.label}@${l.region.zone}` : l.label;
        const prev = best.get(key);
        if (prev === undefined || (l.confidence || 0) > prev.confidence) {
          best.set(key, l.region ? { label: l.label, confidence: l.confidence || 0, region: l.region } : { label: l.label, confidence: l.confidence || 0 });
        }
      }
    }
    return Array.from(best.values());
  }

  /**
   * @param {string} apiKey
   * @param {{ cameraId: string, ts?: number, capturedAt?: number, objects?: Array<{label:string,confidence:number,bbox?:object,trackId?:string}>, framing?: {score:number,notes?:string}|null, visible?: boolean }} detection
   *   `capturedAt` (when the frame was grabbed) orders detections: one older than the last seen for that camera is dropped.
   */
  function ingest(apiKey, detection) {
    const cameraId = String(detection.cameraId);
    const ts = detection.ts || Date.now();
    const cameras = _projectCameras(apiKey);
    const previous = cameras.get(cameraId);
    // A late, out-of-order post must not overwrite newer state. (seq is not used: it restarts with the job.)
    if (detection.capturedAt != null && previous?.capturedAt != null && detection.capturedAt < previous.capturedAt) return;
    const objects = detection.objects || [];
    const framing = detection.framing || null;
    const visible = detection.visible !== false;
    const labels = objects.map((o) => (o.bbox ? { label: o.label, confidence: o.confidence, region: regionOf(o.bbox) } : { label: o.label, confidence: o.confidence }));
    const subjects = objects.filter((o) => o.bbox).map((o) => ({ trackId: o.trackId ?? o.id ?? null, label: o.label, confidence: o.confidence, bbox: o.bbox }));

    cameras.set(cameraId, { labels, visible, lastSeenAt: ts, capturedAt: detection.capturedAt ?? previous?.capturedAt ?? null });

    // 1. Per-camera detail → World State + camera.track_state. Never
    // touches the cue engine (see module doc).
    if (sceneState) {
      const snapshot = sceneState.getState(apiKey);
      snapshot.cameras[cameraId] = { visible, lastSeenAt: ts, labels, framingScore: framing?.score ?? null, framingNotes: framing?.notes || null, subjects };
      snapshot.updatedAt = new Date().toISOString();
    }
    if (eventBus) {
      eventBus.publish(apiKey, 'camera.track_state', { cameraId, ts, labels: labels.map(({ label, confidence }) => ({ label, confidence })), visible, subjects, framing });
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

  /**
   * Drop a project's tracked cameras — for use when the project itself is
   * deleted (code-review fix: `byProject` had no eviction, so every project
   * that ever had a perception job report a detection would keep a
   * permanent entry for the lifetime of the process).
   * @param {string} apiKey
   */
  function clearProject(apiKey) {
    byProject.delete(apiKey);
  }

  return { ingest, clearProject };
}
