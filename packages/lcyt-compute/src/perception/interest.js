/**
 * Interest events from a camera's detection stream (plan_perception_completion.md §5/Phase 3b): the moments
 * when a slow, costly vision model (Describer, Tracker) is worth calling out of its normal timed cadence.
 *
 *   person_entered  a person track appeared (or the person count rose, for detectors without track ids)
 *   person_left     a person track is gone for `leaveGraceMs` (or the count fell)
 *   track_stable    a track has been present for `stableMs` (someone settled in the shot), once per track
 *   framing_dropped the framing score fell below `framingLow` after having been above `framingHigh`
 *
 * Pure: feed it detections in order, it returns the events each one causes. One instance per camera.
 *
 * @param {{ stableMs?: number, leaveGraceMs?: number, framingLow?: number, framingHigh?: number }} [opts]
 */
export function createInterestDetector({ stableMs = 3000, leaveGraceMs = 1000, framingLow = 0.45, framingHigh = 0.6 } = {}) {
  /** @type {Map<string, { since: number, lastSeen: number, stableSent: boolean }>} */
  const tracks = new Map();
  let lastCount = 0;
  let framingOk = null; // null until the first score
  const isPerson = (o) => o.label === 'person';

  /**
   * @param {{ ts: number, objects?: Array<{label: string, trackId?: string|null, id?: string|null}>, framing?: {score?: number}|null, visible?: boolean }} detection
   * @returns {Array<{ kind: string, trackId?: string, count: number, ts: number }>}
   */
  function update(detection) {
    const ts = detection.ts ?? Date.now();
    const events = [];
    const people = detection.visible === false ? [] : (detection.objects || []).filter(isPerson);
    const ids = people.map((o) => o.trackId ?? o.id ?? null);
    const tracked = ids.length > 0 && ids.every((i) => i != null);

    if (tracked || ids.length === 0) {
      const present = new Set(ids);
      for (const id of present) {
        const t = tracks.get(id);
        if (!t) {
          tracks.set(id, { since: ts, lastSeen: ts, stableSent: false });
          events.push({ kind: 'person_entered', trackId: id, count: present.size, ts });
        } else {
          t.lastSeen = ts;
          if (!t.stableSent && ts - t.since >= stableMs) {
            t.stableSent = true;
            events.push({ kind: 'track_stable', trackId: id, count: present.size, ts });
          }
        }
      }
      for (const [id, t] of [...tracks]) {
        if (present.has(id)) continue;
        // everything gone at once (visible:false, empty frame) is a confirmed absence: no grace needed
        if (detection.visible === false || ts - t.lastSeen >= leaveGraceMs) {
          tracks.delete(id);
          events.push({ kind: 'person_left', trackId: id, count: present.size, ts });
        }
      }
      lastCount = present.size;
    } else {
      // Detector without track ids: only counts are known.
      const n = people.length;
      if (n > lastCount) events.push({ kind: 'person_entered', count: n, ts });
      else if (n < lastCount) events.push({ kind: 'person_left', count: n, ts });
      lastCount = n;
    }

    const score = detection.framing?.score;
    if (typeof score === 'number') {
      if (framingOk === null) framingOk = score >= framingLow;
      else if (framingOk && score < framingLow) { framingOk = false; events.push({ kind: 'framing_dropped', count: lastCount, ts }); }
      else if (!framingOk && score >= framingHigh) framingOk = true;
    }
    return events;
  }

  function reset() { tracks.clear(); lastCount = 0; framingOk = null; }

  return { update, reset };
}
