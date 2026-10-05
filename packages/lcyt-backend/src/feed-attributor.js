/**
 * Feed attributor (plan_perception_completion.md §5): answers "which camera is
 * on this project's shared feed right now" once, for every consumer (the
 * shared-feed resolver, the vision roles, the production assistant), and
 * publishes `feed.source_changed` on the EventBus when the answer changes.
 *
 * Sources, strongest first:
 *   operator      — "this is camera N" override, held until the next scene cut
 *   mixer-signal  — DeviceRegistry onProgramChanged / onCameraPresetRecalled
 *   visual-match  — a small loop fingerprints the program-feed preview JPEG and
 *                   matches it with the per-camera / per-preset reference
 *                   images (hold a preset button in the console); only used
 *                   while no mixer signal has been seen recently
 *   unknown       — a real value; nothing downstream may guess a camera
 *
 * Tag: { feedKind: 'shared', cameraId, presetId, mixerId, input, confidence,
 *        method, since }
 *
 * Needs no perception compute: the loop polls the backend's own preview JPEG
 * (the same endpoint the Describer uses), so frames lag by the preview cache
 * time. Swap `fetchFrame` for a local stream decoder to remove that lag.
 */

import * as fs from 'node:fs';
import { frameDiff, jpegToFingerprint, matchFingerprint, createAttributionState } from 'lcyt-compute/perception/attribution';

const HISTORY = 20;

export function unknownTag(since = Date.now()) {
  return { feedKind: 'shared', cameraId: null, presetId: null, mixerId: null, input: null, confidence: 0, method: 'unknown', since };
}

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   registry?: object,
 *   eventBus?: { publish: Function },
 *   previewBaseUrl?: string,
 *   thumbnailsDir?: string,
 *   thumbnailPath: (cameraId: string, dir: string, presetId?: string|null) => string,
 *   fetchFrame?: (apiKey: string) => Promise<{ jpeg: Buffer, capturedAt: number }|null>,
 *   fingerprintJpeg?: (jpeg: Buffer) => Promise<object>,
 *   now?: () => number,
 *   guardMs?: number, signalTtlMs?: number, cutThreshold?: number, refsTtlMs?: number,
 * }} deps
 */
export function createFeedAttributor(deps) {
  const {
    db, registry = null, eventBus = null, previewBaseUrl = null, thumbnailsDir = null, thumbnailPath,
    now = () => Date.now(),
    guardMs = Number(process.env.FEED_SWITCH_GUARD_MS ?? 400),
    signalTtlMs = Number(process.env.FEED_SIGNAL_TTL_MS ?? 10 * 60 * 1000),
    cutThreshold = Number(process.env.FEED_CUT_THRESHOLD ?? 0.12),
    refsTtlMs = 30000,
  } = deps;
  const fingerprintJpeg = deps.fingerprintJpeg ?? ((jpeg) => jpegToFingerprint(jpeg));
  const fetchFrame = deps.fetchFrame ?? defaultFetchFrame(previewBaseUrl, now);

  /** @type {Map<string, object>} */
  const projects = new Map();
  /** @type {Set<Function>} */
  const listeners = new Set();

  function proj(apiKey) {
    let p = projects.get(apiKey);
    if (!p) {
      p = { tag: unknownTag(now()), history: [], lastSignalAt: 0, override: false, loop: null };
      projects.set(apiKey, p);
    }
    return p;
  }

  function setTag(apiKey, fields) {
    const p = proj(apiKey);
    const prev = p.tag;
    const next = { ...unknownTag(now()), ...fields, feedKind: 'shared', since: now() };
    const same = prev.cameraId === next.cameraId && prev.presetId === next.presetId
      && prev.method === next.method && prev.input === next.input && prev.mixerId === next.mixerId;
    if (same) { p.tag = { ...prev, confidence: next.confidence }; return false; }
    p.history.push(prev);
    if (p.history.length > HISTORY) p.history.shift();
    p.tag = next;
    try { eventBus?.publish(apiKey, 'feed.source_changed', next); } catch { /* bus errors never block attribution */ }
    for (const cb of listeners) {
      try { cb({ apiKey, prev, next }); } catch (err) { console.warn(`[feed-attributor] listener error: ${err.message}`); }
    }
    return true;
  }

  // ── mixer / PTZ signals ──────────────────────────────────────────────────
  // mixer_input is only unique within one mixer: scope by mixer_id when the
  // camera has one, fall back to legacy unscoped cameras (see shared-feed-resolver history).
  function cameraForMixerInput(mixerId, inputNumber) {
    if (inputNumber == null) return null;
    if (mixerId != null) {
      const scoped = db.prepare('SELECT id FROM prod_cameras WHERE mixer_input = ? AND mixer_id = ?').get(inputNumber, mixerId);
      if (scoped) return scoped.id;
    }
    const legacy = db.prepare('SELECT id FROM prod_cameras WHERE mixer_input = ? AND mixer_id IS NULL').get(inputNumber);
    return legacy ? legacy.id : null;
  }

  const unsubs = [];
  unsubs.push(registry?.onProgramChanged?.(({ apiKey, mixerId, inputNumber }) => {
    if (!apiKey) return;
    const p = proj(apiKey);
    p.lastSignalAt = now(); p.override = false;
    const cameraId = cameraForMixerInput(mixerId, inputNumber);
    setTag(apiKey, cameraId
      ? { cameraId, mixerId: mixerId ?? null, input: inputNumber ?? null, confidence: 1, method: 'mixer-signal' }
      : { mixerId: mixerId ?? null, input: inputNumber ?? null, confidence: 0, method: 'unknown' });
  }));
  unsubs.push(registry?.onCameraPresetRecalled?.(({ apiKey, cameraId }) => {
    if (!apiKey || !cameraId) return;
    const p = proj(apiKey);
    p.lastSignalAt = now(); p.override = false;
    setTag(apiKey, { cameraId, confidence: 1, method: 'mixer-signal' });
  }));

  // ── operator override ────────────────────────────────────────────────────
  function override(apiKey, cameraId) {
    const p = proj(apiKey);
    if (!cameraId) { // clear
      p.override = false;
      setTag(apiKey, {});
      return p.tag;
    }
    p.override = true;
    setTag(apiKey, { cameraId, confidence: 1, method: 'operator' });
    return p.tag;
  }

  // ── reads ────────────────────────────────────────────────────────────────
  function getTag(apiKey) { return proj(apiKey).tag; }

  /**
   * The tag valid for a frame captured at `capturedAt`. A frame inside the
   * guard window after a change may still show the old shot (encoder delay), so
   * it is reported as unknown rather than tagged with the new camera.
   */
  function tagForCapture(apiKey, capturedAt = now()) {
    const p = proj(apiKey);
    let tag = p.tag;
    let idx = p.history.length - 1;
    while (tag && capturedAt < tag.since && idx >= 0) tag = p.history[idx--];
    if (!tag) return unknownTag(capturedAt);
    if (tag.cameraId && capturedAt - tag.since < guardMs && tag.method !== 'operator') {
      return { ...tag, cameraId: null, presetId: null, confidence: 0, method: 'unknown' };
    }
    return tag;
  }

  /** Tag for a dedicated feed (the feed key already names the camera). */
  function tagForCamera(cameraId) {
    return { feedKind: 'dedicated', cameraId, presetId: null, mixerId: null, input: null, confidence: 1, method: 'feed-key', since: 0 };
  }

  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  // ── visual loop ──────────────────────────────────────────────────────────
  async function loadRefs(apiKey, loop) {
    if (loop.refs && now() - loop.refsAt < refsTtlMs) return loop.refs;
    const cams = db.prepare('SELECT id, thumbnail_captured_at FROM prod_cameras WHERE owner_api_key = ? OR owner_api_key IS NULL').all(apiKey);
    const refs = [];
    const dir = thumbnailsDir;
    const entries = [];
    for (const c of cams) {
      if (c.thumbnail_captured_at) entries.push({ cameraId: c.id, presetId: null, at: c.thumbnail_captured_at });
      for (const r of db.prepare('SELECT preset_id, captured_at FROM prod_camera_preset_thumbnails WHERE camera_id = ?').all(c.id)) {
        entries.push({ cameraId: c.id, presetId: r.preset_id, at: r.captured_at });
      }
    }
    for (const e of entries) {
      const key = `${e.cameraId}|${e.presetId ?? ''}|${e.at}`;
      let fp = loop.refCache.get(key);
      if (!fp) {
        try {
          fp = await fingerprintJpeg(fs.readFileSync(thumbnailPath(e.cameraId, dir, e.presetId)));
          loop.refCache.set(key, fp);
        } catch { continue; } // missing/corrupt reference: skip it
      }
      refs.push({ cameraId: e.cameraId, presetId: e.presetId, fp });
    }
    loop.refs = refs; loop.refsAt = now();
    return refs;
  }

  async function tick(apiKey) {
    const p = proj(apiKey);
    const loop = p.loop;
    if (!loop || loop.busy) return;
    loop.busy = true;
    try {
      const frame = await fetchFrame(apiKey);
      if (!frame?.jpeg) { loop.lastError = 'no frame'; return; }
      const fp = await fingerprintJpeg(frame.jpeg);
      const cut = loop.prevFp ? frameDiff(loop.prevFp, fp) > cutThreshold : false;
      loop.prevFp = fp;
      loop.frames += 1;
      loop.lastFrameAt = now();
      loop.lastError = null;
      if (cut) { loop.cuts += 1; if (p.override) { p.override = false; } }

      const refs = await loadRefs(apiKey, loop);
      loop.refCount = refs.length;
      const match = refs.length ? matchFingerprint(fp, refs) : null;
      const res = loop.state.update(match, { cut });
      if (p.override) return;
      if (p.lastSignalAt > 0 && now() - p.lastSignalAt < signalTtlMs) return; // mixer signals own the tag
      if (res.changed) {
        setTag(apiKey, res.cameraId
          ? { cameraId: res.cameraId, presetId: res.presetId, confidence: res.confidence, method: 'visual-match' }
          : {});
      }
    } catch (err) {
      loop.lastError = err.message;
    } finally {
      loop.busy = false;
    }
  }

  function start(apiKey, { intervalMs = Number(process.env.FEED_ATTRIBUTION_INTERVAL_MS ?? 2000) } = {}) {
    const p = proj(apiKey);
    if (p.loop) return status(apiKey);
    p.loop = {
      timer: null, busy: false, state: createAttributionState(), prevFp: null, refs: null, refsAt: 0,
      refCache: new Map(), frames: 0, cuts: 0, refCount: 0, lastFrameAt: null, lastError: null, intervalMs, startedAt: now(),
    };
    p.loop.timer = setInterval(() => { void tick(apiKey); }, intervalMs);
    p.loop.timer.unref?.();
    void tick(apiKey);
    return status(apiKey);
  }

  function stop(apiKey) {
    const p = projects.get(apiKey);
    if (!p?.loop) return false;
    clearInterval(p.loop.timer);
    p.loop = null;
    return true;
  }

  function status(apiKey) {
    const p = proj(apiKey);
    const l = p.loop;
    return {
      running: !!l, tag: p.tag, override: p.override,
      signalFresh: now() - p.lastSignalAt < signalTtlMs && p.lastSignalAt > 0,
      ...(l ? { intervalMs: l.intervalMs, frames: l.frames, cuts: l.cuts, references: l.refCount, lastFrameAt: l.lastFrameAt, lastError: l.lastError } : {}),
    };
  }

  function clearProject(apiKey) { stop(apiKey); projects.delete(apiKey); }

  function shutdown() {
    for (const k of [...projects.keys()]) stop(k);
    for (const u of unsubs) u?.();
  }

  return { getTag, tagForCapture, tagForCamera, onChange, override, start, stop, status, clearProject, shutdown, _tick: tick };
}

function defaultFetchFrame(previewBaseUrl, now) {
  return async (apiKey) => {
    if (!previewBaseUrl) return null;
    const res = await fetch(`${previewBaseUrl.replace(/\/$/, '')}/preview/${encodeURIComponent(apiKey)}/incoming`);
    if (!res.ok) return null;
    return { jpeg: Buffer.from(await res.arrayBuffer()), capturedAt: now() };
  };
}
