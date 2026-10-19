/**
 * Source resolver for the camera-scoped vision roles (Tracker/Describer in
 * lcyt-agent, plan_perception_completion.md §5.5): bridges the feed attributor
 * and the production camera table into the small interface
 * `VisionRoleManager.setSourceResolver()` expects. Lives in lcyt-backend
 * because lcyt-agent must not depend on lcyt-production or this attributor.
 */
import { linkedFeedKeys } from 'lcyt-production';

/**
 * @param {{ db: import('./db/connection.js').Db,
 *           attributor: { tagForCapture: Function, tagForCamera: Function },
 *           sceneState?: { getState: (apiKey: string) => object },
 *           aggregator?: { labelTrack: Function },
 *           now?: () => number }} deps
 */
const FRESH_MS = 10000;

function place(bbox) {
  const cx = bbox.x + bbox.w / 2; const cy = bbox.y + bbox.h / 2;
  const third = (v, names) => (v < 1 / 3 ? names[0] : v > 2 / 3 ? names[2] : names[1]);
  return `${third(cy, ['top', 'middle', 'bottom'])} ${third(cx, ['left', 'center', 'right'])}`;
}

export function createVisionSourceResolver({ db, attributor, sceneState = null, aggregator = null, now = () => Date.now() }) {
  async function row(cameraId) {
    return (await db.prod_cameras.findUnique({
      where: { id: cameraId },
      select: { id: true, name: true, label: true, zone: true, owner_api_key: true, overlap_links: true },
    })) ?? null;
  }

  return {
    tagForCapture: (apiKey, ts) => attributor.tagForCapture(apiKey, ts),
    tagForCamera: (cameraId) => attributor.tagForCamera(cameraId),

    async feedKeyFor(cameraId) {
      const r = await row(cameraId);
      if (!r) return null;
      return (await linkedFeedKeys(db, [r.id])).get(r.id) || null;
    },

    async cameraAllowed(apiKey, cameraId) {
      const r = await row(cameraId);
      return !!r && (!r.owner_api_key || r.owner_api_key === apiKey);
    },

    /** Current person subjects of a camera from the fast detector, or [] when stale/unknown. */
    subjectsFor(apiKey, cameraId) {
      const cam = sceneState?.getState(apiKey)?.cameras?.[cameraId];
      if (!cam || !cam.visible || now() - (cam.lastSeenAt ?? 0) > FRESH_MS) return [];
      return cam.subjects || [];
    },

    /** Bind a model-given role (e.g. "preacher") to a detector track. */
    labelTrack(apiKey, cameraId, trackId, role, confidence) {
      return aggregator?.labelTrack?.(apiKey, cameraId, trackId, role, confidence) ?? false;
    },

    /** What the fast detector sees right now, as prompt text for a vision role. Null when there is nothing fresh. */
    detectorHints(apiKey, cameraId, roleCode) {
      const cam = sceneState?.getState(apiKey)?.cameras?.[cameraId];
      if (!cam || !cam.visible || now() - (cam.lastSeenAt ?? 0) > FRESH_MS) return null;
      const people = (cam.subjects || []).filter((s) => s.label === 'person' && s.bbox);
      if (!people.length) return 'A fast detector currently sees no people in this frame.';
      const list = people.map((s) => `${s.trackId != null ? `track ${s.trackId}` : 'a person'} (${place(s.bbox)}${s.role ? `, already identified as ${s.role}` : ''})`).join('; ');
      let text = `A fast detector currently sees ${people.length} ${people.length === 1 ? 'person' : 'people'}: ${list}.`;
      if (cam.framingNotes?.length) text += ` Framing notes: ${[].concat(cam.framingNotes).join(', ')}.`;
      if (roleCode === 'tracker' && people.some((s) => s.trackId != null)) text += ' When you report a person that matches one of these tracks, include its "trackId" in that object.';
      return text;
    },

    /** One short sentence for the prompt: which camera this is, where it sits, what it overlaps with. */
    async cameraContext(apiKey, cameraId) {
      const r = await row(cameraId);
      if (!r || (r.owner_api_key && r.owner_api_key !== apiKey)) return null;
      const name = r.label || r.name;
      let text = `This frame is from camera "${name}"${r.zone ? ` (placed ${r.zone})` : ''}.`;
      let links = [];
      try { links = JSON.parse(r.overlap_links || '[]'); } catch { links = []; }
      const others = await Promise.all(links.map((l) => (l?.cameraId ? row(l.cameraId) : null)));
      const names = [...new Set(others.map((o) => (o ? (o.label || o.name) : null)).filter(Boolean))];
      if (names.length) text += ` Its view can overlap with: ${names.join(', ')}.`;
      return text;
    },
  };
}
