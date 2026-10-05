/**
 * Visual feed attribution (plan_perception_completion.md §5): decide which
 * camera/preset a frame of a shared feed shows by comparing a tiny fingerprint
 * of it with per-camera and per-preset reference images. Pure and dependency
 * free; the caller supplies raw 16x9 RGB bytes (see jpegToFingerprint).
 *
 * Nothing here guesses: a frame that is not clearly closest to one camera is
 * reported as no match, and the hysteresis state turns that into `unknown`.
 */

import { spawn } from 'node:child_process';

export const FP_WIDTH = 16;
export const FP_HEIGHT = 9;
const FP_BYTES = FP_WIDTH * FP_HEIGHT * 3;

/**
 * @param {Uint8Array|Buffer} rgb  FP_WIDTH x FP_HEIGHT rgb24 bytes
 * @returns {{ raw: Uint8Array, vec: Float32Array }}
 */
export function fingerprintFromRgb(rgb) {
  if (!rgb || rgb.length !== FP_BYTES) throw new Error(`fingerprint needs ${FP_BYTES} rgb bytes, got ${rgb?.length ?? 0}`);
  const raw = Uint8Array.from(rgb);
  // Mean-removed, unit-length vector: similarity is then a correlation that
  // ignores overall exposure changes between the reference and the live shot.
  let mean = 0;
  for (let i = 0; i < raw.length; i++) mean += raw[i];
  mean /= raw.length;
  const vec = new Float32Array(raw.length);
  let norm = 0;
  for (let i = 0; i < raw.length; i++) { vec[i] = raw[i] - mean; norm += vec[i] * vec[i]; }
  norm = Math.sqrt(norm);
  if (norm > 1e-6) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return { raw, vec };
}

/** Correlation of two fingerprints, -1..1 (a flat frame correlates 0 with everything). */
export function similarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.vec.length; i++) dot += a.vec[i] * b.vec[i];
  return dot;
}

/** Mean absolute pixel difference of two fingerprints, 0..1 (scene-cut signal). */
export function frameDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.raw.length; i++) sum += Math.abs(a.raw[i] - b.raw[i]);
  return sum / (a.raw.length * 255);
}

/**
 * Best camera for a fingerprint.
 * @param {{ raw: Uint8Array, vec: Float32Array }} fp
 * @param {Array<{ cameraId: string, presetId?: string|null, fp: object }>} refs
 * @param {{ minSimilarity?: number, minMargin?: number, soloMinSimilarity?: number }} [opts]
 * @returns {{ cameraId: string, presetId: string|null, similarity: number, margin: number|null, confidence: number } | null}
 */
export function matchFingerprint(fp, refs, opts = {}) {
  const { minSimilarity = 0.6, minMargin = 0.05, soloMinSimilarity = 0.75 } = opts;
  /** @type {Map<string, {sim:number, presetId:string|null}>} */
  const best = new Map();
  for (const ref of refs) {
    const sim = similarity(fp, ref.fp);
    const cur = best.get(ref.cameraId);
    if (!cur || sim > cur.sim) best.set(ref.cameraId, { sim, presetId: ref.presetId ?? null });
  }
  if (best.size === 0) return null;
  const ranked = [...best.entries()].sort((x, y) => y[1].sim - x[1].sim);
  const [cameraId, top] = ranked[0];
  const second = ranked[1]?.[1].sim ?? null;
  const margin = second == null ? null : top.sim - second;

  if (top.sim < minSimilarity) return null;
  if (margin == null) {
    if (top.sim < soloMinSimilarity) return null;
  } else if (margin < minMargin) {
    return null;
  }
  const simPart = Math.min(1, (top.sim - minSimilarity) / (1 - minSimilarity));
  const marginPart = margin == null ? 1 : Math.min(1, margin / 0.3);
  const confidence = Math.round((0.5 * simPart + 0.5 * marginPart) * 100) / 100;
  return { cameraId, presetId: top.presetId, similarity: top.sim, margin, confidence };
}

/**
 * Hysteresis over per-frame matches so a held shot does not flicker and one
 * odd frame (a dissolve, someone walking past) does not switch the source.
 *
 * update() returns { cameraId, presetId, confidence, changed }. `cameraId` is
 * null while the source is unknown.
 *
 * @param {{ switchFrames?: number, unknownFrames?: number }} [opts]
 */
export function createAttributionState({ switchFrames = 2, unknownFrames = 3 } = {}) {
  let current = { cameraId: null, presetId: null, confidence: 0 };
  let pendingId = null;
  let pendingCount = 0;
  let unknownCount = 0;

  /**
   * @param {object|null} match  matchFingerprint() result
   * @param {{ cut?: boolean }} [info]  cut: a scene cut was seen on this frame (speeds up a switch by one frame)
   */
  function update(match, { cut = false } = {}) {
    let changed = false;
    if (match) {
      unknownCount = 0;
      if (match.cameraId === current.cameraId) {
        pendingId = null; pendingCount = 0;
        const next = { cameraId: match.cameraId, presetId: match.presetId, confidence: match.confidence };
        if (next.presetId !== current.presetId) changed = true; // same camera, other preset: report, cheap
        current = next;
      } else {
        if (pendingId === match.cameraId) pendingCount += cut ? 2 : 1;
        else { pendingId = match.cameraId; pendingCount = cut ? 2 : 1; }
        if (pendingCount >= switchFrames) {
          current = { cameraId: match.cameraId, presetId: match.presetId, confidence: match.confidence };
          pendingId = null; pendingCount = 0;
          changed = true;
        }
      }
    } else {
      pendingId = null; pendingCount = 0;
      unknownCount += 1;
      if (current.cameraId !== null && (unknownCount >= unknownFrames || cut && unknownCount >= 2)) {
        current = { cameraId: null, presetId: null, confidence: 0 };
        changed = true;
      }
    }
    return { ...current, changed };
  }

  function reset() {
    current = { cameraId: null, presetId: null, confidence: 0 };
    pendingId = null; pendingCount = 0; unknownCount = 0;
  }

  return { update, reset, get current() { return current; } };
}

/**
 * Decode a JPEG to a fingerprint with one ffmpeg run (plain scale, no letterbox,
 * so a 4:3 reference and a 16:9 live frame are compared the same way).
 *
 * @param {Buffer} jpeg
 * @param {{ ffmpegPath?: string, timeoutMs?: number }} [opts]
 */
export function jpegToFingerprint(jpeg, { ffmpegPath = 'ffmpeg', timeoutMs = 8000 } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-vf', `scale=${FP_WIDTH}:${FP_HEIGHT}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('fingerprint decode timed out')); }, timeoutMs);
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', () => {
      clearTimeout(timer);
      const data = Buffer.concat(chunks);
      if (data.length !== FP_BYTES) return reject(new Error(`fingerprint decode produced ${data.length} bytes`));
      resolve(fingerprintFromRgb(data));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(jpeg);
  });
}
