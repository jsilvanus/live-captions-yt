/**
 * Scene summary for the Production Assistant (plan_perception_completion.md Phase 4): a few lines of what the
 * fast detector and the feed attributor currently know, so the Assistant can reason about "which camera is on,
 * who is where, which camera has a person in a good shot" instead of only reading transcript context.
 * Read-only text, nothing here triggers an action.
 */

const FRESH_MS = 30000;

function place(bbox) {
  const cx = bbox.x + bbox.w / 2; const cy = bbox.y + bbox.h / 2;
  const third = (v, names) => (v < 1 / 3 ? names[0] : v > 2 / 3 ? names[2] : names[1]);
  return `${third(cy, ['top', 'middle', 'bottom'])} ${third(cx, ['left', 'center', 'right'])}`;
}

/**
 * @param {{ db: import('better-sqlite3').Database,
 *           sceneState: { getState: (apiKey: string) => object },
 *           attributor?: { getTag: (apiKey: string) => object },
 *           now?: () => number }} deps
 * @returns {(apiKey: string) => string|null}
 */
export function createSceneSummary({ db, sceneState, attributor = null, now = () => Date.now() }) {
  return function summarise(apiKey) {
    const cams = sceneState.getState(apiKey)?.cameras || {};
    const tag = attributor?.getTag?.(apiKey) ?? null;
    const lines = [];
    if (tag) {
      const onAir = tag.cameraId ? db.prepare('SELECT name, label FROM prod_cameras WHERE id = ?').get(tag.cameraId) : null;
      lines.push(onAir
        ? `On program: camera "${onAir.label || onAir.name}" (identified by ${tag.method}, confidence ${Math.round((tag.confidence ?? 0) * 100)}%).`
        : 'On program: unknown camera.');
    }
    for (const [cameraId, cam] of Object.entries(cams)) {
      if (now() - (cam.lastSeenAt ?? 0) > FRESH_MS) continue;
      const row = db.prepare('SELECT name, label, zone FROM prod_cameras WHERE id = ?').get(cameraId);
      const name = row ? (row.label || row.name) : cameraId;
      const people = (cam.subjects || []).filter((s) => s.label === 'person' && s.bbox);
      let text = `- "${name}"${tag?.cameraId === cameraId ? ' (on program)' : ''}: `;
      if (!cam.visible || people.length === 0) text += 'no people seen';
      else text += `${people.length} ${people.length === 1 ? 'person' : 'people'} (${people.map((s) => `${place(s.bbox)}${s.role ? `, ${s.role}` : ''}`).join('; ')})`;
      if (typeof cam.framingScore === 'number') text += `, framing ${cam.framingScore.toFixed(2)}`;
      if (cam.framingNotes?.length) text += ` [${[].concat(cam.framingNotes).join(', ')}]`;
      lines.push(text);
    }
    return lines.length ? lines.join('\n') : null;
  };
}
