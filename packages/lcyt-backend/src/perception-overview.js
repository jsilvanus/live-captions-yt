/**
 * Perception overview for the camera status panel (plan_perception_completion.md Phase 4): one read of everything an
 * operator needs to see whether the detector is working: per camera the job, the auto-start switch, whether it is on
 * program and what the detector last saw; the shared-feed job; and the feed attribution.
 */
import { linkedFeedKeys } from 'lcyt-production';

/**
 * @param {{
 *   db: import('./db/connection.js').Db,
 *   sceneState: { getState: (apiKey: string) => { cameras?: object } },
 *   attributor: { status: (apiKey: string) => object },
 *   perceptionManager: { status: (id: string) => object|null, sharedFeedStatus: (apiKey: string) => object|null },
 *   sharedAutostart: { get: (apiKey: string) => boolean | Promise<boolean> },
 *   now?: () => number,
 * }} deps
 * @returns {(apiKey: string) => Promise<object>}
 */
export function createPerceptionOverview({ db, sceneState, attributor, perceptionManager, sharedAutostart, now = () => Date.now() }) {
  return async function overview(apiKey) {
    const attribution = attributor.status(apiKey);
    const scene = sceneState.getState(apiKey)?.cameras || {};
    const cameras0 = await db.prod_cameras.findMany({
      where: { OR: [{ owner_api_key: apiKey }, { owner_api_key: null }] },
      select: { id: true, name: true, label: true, zone: true, perception_enabled: true, mixer_input: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    const feedKeys = await linkedFeedKeys(db, cameras0.map((c) => c.id));
    const rows = cameras0.map((c) => ({ ...c, feedKey: feedKeys.get(c.id) ?? null }));
    const cameras = rows.map((r) => {
      const s = scene[r.id] ?? null;
      const people = s ? (s.subjects || []).filter((x) => x.label === 'person') : [];
      return {
        id: r.id,
        name: r.label || r.name,
        zone: r.zone ?? null,
        hasFeed: !!r.feedKey,
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
      shared: { running: !!perceptionManager.sharedFeedStatus(apiKey), auto: !!(await sharedAutostart.get(apiKey)) },
      cameras,
    };
  };
}
