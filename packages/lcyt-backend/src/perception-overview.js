/**
 * Perception overview for the camera status panel (plan_perception_completion.md Phase 4): one read of everything an
 * operator needs to see whether the detector is working: per camera the job, the auto-start switch, whether it is on
 * program and what the detector last saw; the shared-feed job; and the feed attribution.
 */

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   sceneState: { getState: (apiKey: string) => { cameras?: object } },
 *   attributor: { status: (apiKey: string) => object },
 *   perceptionManager: { status: (id: string) => object|null, sharedFeedStatus: (apiKey: string) => object|null },
 *   sharedAutostart: { get: (apiKey: string) => boolean },
 *   now?: () => number,
 * }} deps
 * @returns {(apiKey: string) => object}
 */
export function createPerceptionOverview({ db, sceneState, attributor, perceptionManager, sharedAutostart, now = () => Date.now() }) {
  return function overview(apiKey) {
    const attribution = attributor.status(apiKey);
    const scene = sceneState.getState(apiKey)?.cameras || {};
    const rows = db.prepare(
      'SELECT id, name, label, zone, camera_key, perception_enabled, mixer_input FROM prod_cameras WHERE owner_api_key = ? OR owner_api_key IS NULL ORDER BY sort_order, name'
    ).all(apiKey);
    const cameras = rows.map((r) => {
      const s = scene[r.id] ?? null;
      const people = s ? (s.subjects || []).filter((x) => x.label === 'person') : [];
      return {
        id: r.id,
        name: r.label || r.name,
        zone: r.zone ?? null,
        hasFeed: !!r.camera_key,
        perceptionEnabled: !!r.perception_enabled,
        jobRunning: !!perceptionManager.status(r.id),
        onProgram: attribution.tag?.cameraId === r.id,
        scene: s ? {
          visible: !!s.visible,
          people: people.length,
          roles: people.map((p) => p.role).filter(Boolean),
          framingScore: s.framingScore ?? null,
          framingNotes: s.framingNotes ?? null,
          ageMs: Math.max(0, now() - (s.lastSeenAt ?? 0)),
        } : null,
      };
    });
    return {
      attribution,
      shared: { running: !!perceptionManager.sharedFeedStatus(apiKey), auto: !!sharedAutostart.get(apiKey) },
      cameras,
    };
  };
}
