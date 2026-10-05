/**
 * Multi-object tracker in the ByteTrack style, plain JS, no dependencies.
 *
 * Gives detections stable ids across frames so "person t3 is still in shot" means something. Each
 * track keeps a small constant-velocity Kalman filter per box component (centre x, centre y,
 * height, aspect ratio). Per step: predict every track, match confident detections to tracks by
 * IoU (Hungarian assignment), then match the tracks left over to the weak detections (which keeps a
 * track alive through a bad frame instead of splitting it), start new tracks from unmatched
 * confident detections, and drop tracks that have gone unmatched for `maxLost` steps. A new track is
 * only reported after `minHits` matches, so one-frame false positives never get an id.
 *
 * Boxes are normalised `{ x, y, w, h }` (top-left, 0..1). Steps are detections, not seconds: at
 * about 5 detections/s the default `maxLost` of 10 is roughly two seconds.
 */

/** Intersection over union of two `{ x, y, w, h }` boxes. */
export function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Minimum-cost assignment (Hungarian algorithm, O(n^3)); rows and columns may differ in number.
 * @param {number[][]} cost  rows x cols
 * @returns {Array<[number, number]>} matched [row, col] pairs
 */
export function assign(cost) {
  const rows = cost.length;
  const cols = rows ? cost[0].length : 0;
  if (!rows || !cols) return [];
  const n = Math.max(rows, cols);
  const BIG = 1e6;
  // Square matrix, padded with BIG so padding never wins over a real pair.
  const a = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) a[i][j] = i <= rows && j <= cols ? cost[i - 1][j - 1] : BIG;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const pairs = [];
  for (let j = 1; j <= n; j++) if (p[j] >= 1 && p[j] <= rows && j <= cols) pairs.push([p[j] - 1, j - 1]);
  return pairs;
}

/** One-dimensional constant-velocity Kalman filter. */
class Kalman1D {
  constructor(x, q, r) {
    this.x = x; this.v = 0; this.q = q; this.r = r;
    // 2x2 covariance [[pxx, pxv], [pxv, pvv]]
    this.pxx = 1; this.pxv = 0; this.pvv = 1;
  }

  predict() {
    this.x += this.v;
    const pxx = this.pxx + 2 * this.pxv + this.pvv + this.q;
    const pxv = this.pxv + this.pvv;
    this.pxx = pxx; this.pxv = pxv; this.pvv = this.pvv + this.q;
  }

  update(z) {
    const s = this.pxx + this.r;
    const kx = this.pxx / s;
    const kv = this.pxv / s;
    const y = z - this.x;
    this.x += kx * y;
    this.v += kv * y;
    const pxx = (1 - kx) * this.pxx;
    const pxv = (1 - kx) * this.pxv;
    const pvv = this.pvv - kv * this.pxv;
    this.pxx = pxx; this.pxv = pxv; this.pvv = pvv;
  }
}

const toState = (b) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2, h: b.h, a: b.h > 0 ? b.w / b.h : 1 });
const fromState = (cx, cy, h, a) => {
  const w = h * a;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
};

class Track {
  constructor(id, det) {
    const s = toState(det.bbox);
    this.id = id;
    this.label = det.label;
    this.confidence = det.confidence;
    // Process noise is small (people move little between detections); measurement noise is larger.
    this.kcx = new Kalman1D(s.cx, 1e-4, 4e-4);
    this.kcy = new Kalman1D(s.cy, 1e-4, 4e-4);
    this.kh = new Kalman1D(s.h, 1e-4, 4e-4);
    this.ka = new Kalman1D(s.a, 1e-5, 1e-3);
    this.hits = 1;
    this.lost = 0;
    this.age = 1;
    this.confirmed = false;
  }

  predict() {
    this.kcx.predict(); this.kcy.predict(); this.kh.predict(); this.ka.predict();
    this.age++;
  }

  get box() { return fromState(this.kcx.x, this.kcy.x, this.kh.x, this.ka.x); }

  update(det) {
    const s = toState(det.bbox);
    this.kcx.update(s.cx); this.kcy.update(s.cy); this.kh.update(s.h); this.ka.update(s.a);
    this.confidence = det.confidence;
    this.hits++;
    this.lost = 0;
  }
}

/**
 * @param {{ highThreshold?: number, lowThreshold?: number, matchIou?: number, maxLost?: number, minHits?: number }} [opts]
 *   highThreshold: confidence for "confident" detections (0.5); lowThreshold: weakest detection that may keep a track (0.1);
 *   matchIou: lowest IoU that still counts as the same object (0.3); maxLost: steps a track survives unmatched (10);
 *   minHits: matches before a track is reported (2).
 */
export function createTracker({ highThreshold = 0.5, lowThreshold = 0.1, matchIou = 0.3, maxLost = 10, minHits = 2 } = {}) {
  let tracks = [];
  let nextId = 1;

  function match(trackList, dets) {
    if (!trackList.length || !dets.length) return { pairs: [], freeTracks: trackList.map((_, i) => i), freeDets: dets.map((_, i) => i) };
    const cost = trackList.map((t) => dets.map((d) => 1 - iou(t.box, d.bbox)));
    const pairs = assign(cost).filter(([i, j]) => 1 - cost[i][j] >= matchIou);
    const usedT = new Set(pairs.map((p) => p[0]));
    const usedD = new Set(pairs.map((p) => p[1]));
    return {
      pairs,
      freeTracks: trackList.map((_, i) => i).filter((i) => !usedT.has(i)),
      freeDets: dets.map((_, i) => i).filter((i) => !usedD.has(i)),
    };
  }

  return {
    /**
     * @param {Array<{ label: string, confidence: number, bbox: { x: number, y: number, w: number, h: number } }>} detections
     * @returns {Array<{ trackId: string, label: string, confidence: number, bbox: object, hits: number, age: number }>} confirmed, currently matched tracks
     */
    update(detections) {
      for (const t of tracks) t.predict();
      const high = detections.filter((d) => d.confidence >= highThreshold);
      const low = detections.filter((d) => d.confidence < highThreshold && d.confidence >= lowThreshold);
      const matchedNow = new Set();

      // Same-label matching only: a person box never takes over a track of another class.
      const first = match(tracks, high);
      for (const [ti, di] of first.pairs) {
        if (tracks[ti].label !== high[di].label) { first.freeTracks.push(ti); first.freeDets.push(di); continue; }
        tracks[ti].update(high[di]);
        matchedNow.add(tracks[ti]);
      }
      const rest = first.freeTracks.map((i) => tracks[i]).filter((t) => !matchedNow.has(t));
      const second = match(rest, low);
      for (const [ti, di] of second.pairs) {
        if (rest[ti].label !== low[di].label) continue;
        rest[ti].update(low[di]);
        matchedNow.add(rest[ti]);
      }
      for (const di of first.freeDets) {
        const det = high[di];
        const t = new Track(`t${nextId++}`, det);
        matchedNow.add(t);
        tracks.push(t);
      }
      for (const t of tracks) {
        if (!matchedNow.has(t)) t.lost++;
        if (!t.confirmed && t.hits >= minHits) t.confirmed = true;
      }
      // A tentative track that missed once is dropped at once; a confirmed one gets maxLost steps.
      tracks = tracks.filter((t) => (t.confirmed ? t.lost <= maxLost : t.lost === 0));

      return tracks
        .filter((t) => t.confirmed && matchedNow.has(t))
        .map((t) => {
          const b = t.box;
          const round = (v) => Math.round(Math.min(Math.max(v, 0), 1) * 1000) / 1000;
          const x = round(b.x);
          const y = round(b.y);
          return { trackId: t.id, label: t.label, confidence: t.confidence, bbox: { x, y, w: round(Math.min(b.x + b.w, 1)) - x, h: round(Math.min(b.y + b.h, 1)) - y }, hits: t.hits, age: t.age };
        });
    },

    /** Forget every track (camera went off air). Ids keep counting up so an old id is never reused. */
    reset() {
      tracks = [];
    },
  };
}
