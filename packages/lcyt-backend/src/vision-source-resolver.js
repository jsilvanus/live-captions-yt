/**
 * Source resolver for the camera-scoped vision roles (Tracker/Describer in
 * lcyt-agent, plan_perception_completion.md §5.5): bridges the feed attributor
 * and the production camera table into the small interface
 * `VisionRoleManager.setSourceResolver()` expects. Lives in lcyt-backend
 * because lcyt-agent must not depend on lcyt-production or this attributor.
 */

/**
 * @param {{ db: import('better-sqlite3').Database,
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
  function row(cameraId) {
    return db.prepare('SELECT id, name, label, zone, camera_key, owner_api_key, overlap_links FROM prod_cameras WHERE id = ?').get(cameraId) ?? null;
  }

  return {
    tagForCapture: (apiKey, ts) => attributor.tagForCapture(apiKey, ts),
    tagForCamera: (cameraId) => attributor.tagForCamera(cameraId),

    feedKeyFor(cameraId) {
      return row(cameraId)?.camera_key || null;
    },

    cameraAllowed(apiKey, cameraId) {
      const r = row(cameraId);
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
    cameraContext(apiKey, cameraId) {
      const r = row(cameraId);
      if (!r || (r.owner_api_key && r.owner_api_key !== apiKey)) return null;
      const name = r.label || r.name;
      let text = `This frame is from camera "${name}"${r.zone ? ` (placed ${r.zone})` : ''}.`;
      let links = [];
      try { links = JSON.parse(r.overlap_links || '[]'); } catch { links = []; }
      const names = [...new Set(links.map((l) => {
        const o = l?.cameraId ? row(l.cameraId) : null;
        return o ? (o.label || o.name) : null;
      }).filter(Boolean))];
      if (names.length) text += ` Its view can overlap with: ${names.join(', ')}.`;
      return text;
    },
  };
}
