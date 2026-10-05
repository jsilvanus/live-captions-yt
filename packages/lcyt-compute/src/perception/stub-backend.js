/**
 * Stub detector backend (plan_video_perception.md Phase 2 Stream A).
 *
 * No real CV model runs here — see runner.js's module doc for why. This
 * produces deterministic, slowly-varying fake detections so the rest of the
 * pipeline (job dispatch, callback delivery, cue-engine `track:` rules,
 * World State) can be built and tested end-to-end against a real event
 * shape before a real YOLO/ByteTrack backend exists. A real backend is a
 * follow-on task that implements this same `{ detect(frameBuffer) }`
 * interface — nothing downstream needs to change when it lands.
 */

/**
 * @returns {{ detect: (frame: Buffer|null) => Promise<{ objects: object[], framing: object|null }> }}
 */
export function createStubDetector() {
  let tick = 0;
  return {
    async detect(frame) {
      tick += 1;
      if (!frame) return { objects: [], framing: null };
      const x = Math.round((0.3 + 0.1 * Math.sin(tick / 5)) * 1000) / 1000;
      return {
        objects: [
          { id: 'stub-1', label: 'person', confidence: 0.82, bbox: { x, y: 0.2, w: 0.25, h: 0.6 } },
        ],
        framing: { score: 0.7, notes: 'stub detector — placeholder framing score' },
      };
    },
  };
}
