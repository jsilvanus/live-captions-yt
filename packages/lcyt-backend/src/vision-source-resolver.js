/**
 * Source resolver for the camera-scoped vision roles (Tracker/Describer in
 * lcyt-agent, plan_perception_completion.md §5.5): bridges the feed attributor
 * and the production camera table into the small interface
 * `VisionRoleManager.setSourceResolver()` expects. Lives in lcyt-backend
 * because lcyt-agent must not depend on lcyt-production or this attributor.
 */

/**
 * @param {{ db: import('better-sqlite3').Database,
 *           attributor: { tagForCapture: Function, tagForCamera: Function } }} deps
 */
export function createVisionSourceResolver({ db, attributor }) {
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
