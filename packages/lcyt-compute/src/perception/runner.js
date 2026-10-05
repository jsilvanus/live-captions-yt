/**
 * fps30 tracker subsystem runner interface (plan_video_perception.md §1,
 * tmp_plan_video_perception.md Phase 2 Stream A).
 *
 * Process-boundary decision (written down per the phase plan's request,
 * so Streams B/C don't have to re-derive it): this ships as a plain
 * in-process Node module, not a subprocess or sidecar container. Phase 2
 * ships only a stub detector (see stub-backend.js) — no real
 * YOLO/ByteTrack integration exists in this repo, so there is nothing to
 * isolate into its own process yet. When a real model backend lands (a
 * follow-on task, not scoped here), it decides its own process boundary
 * then — likely a Python subprocess or sidecar container, following the
 * docker/lcyt-dsk-renderer precedent — without needing to change this
 * runner's start/stop/emit contract below.
 *
 * Rate note: the plan's "fps30" label describes the class of subsystem
 * (a local, bounded-rate per-camera loop, as opposed to VLM-based 5s
 * polling), not a literal 30 Hz frame grab — the frame source this phase
 * uses (frame-source.js) polls the existing preview-JPEG snapshot route,
 * which updates on `PREVIEW_INTERVAL_S` (default 5s), not 30 times/second.
 * `emitIntervalMs` is independent of the frame source's own update rate,
 * so swapping in a genuinely higher-rate frame source later is a
 * frameSource change, not a contract change.
 */

/**
 * @param {string} cameraId
 * @param {{ getFrame: () => Promise<Buffer|null> }} frameSource
 * @param {{
 *   emitIntervalMs?: number,
 *   backend: { detect: (frame: Buffer|null) => Promise<{ objects: object[], framing: object|null }> },
 *   onDetection?: (detection: object) => void,
 *   onError?: (err: Error) => void,
 * }} config
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createPerceptionRunner(cameraId, frameSource, config = {}) {
  const emitIntervalMs = Math.max(200, config.emitIntervalMs || 1000);
  const backend = config.backend;
  const onDetection = typeof config.onDetection === 'function' ? config.onDetection : () => {};
  const onError = typeof config.onError === 'function' ? config.onError : () => {};

  let timer = null;
  let stopped = true;

  async function tick() {
    if (stopped) return;
    try {
      const frame = await frameSource.getFrame();
      const result = await backend.detect(frame);
      onDetection({
        cameraId,
        ts: Date.now(),
        objects: result.objects || [],
        framing: result.framing || null,
        visible: !!frame,
      });
    } catch (err) {
      onError(err);
    } finally {
      if (!stopped) timer = setTimeout(tick, emitIntervalMs);
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
