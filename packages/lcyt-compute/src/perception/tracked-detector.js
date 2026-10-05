import { createTracker } from './tracker.js';
import { scoreFraming } from './framing.js';

/**
 * Wrap a detector so its detections become tracked objects with stable ids and a framing score.
 * `detect(frame)` keeps the runner's contract: `{ objects, framing }`, where each object now carries
 * `trackId` (and `id`, the same value, for consumers of the older shape).
 *
 * @param {{ detect: Function, inputSize?: number, close?: Function }} inner
 * @param {{ tracker?: object, trackerOptions?: object }} [opts]
 */
export function createTrackedDetector(inner, { tracker = createTracker(), framing = scoreFraming } = {}) {
  return {
    inputSize: inner.inputSize,
    async detect(frame) {
      if (!frame) {
        // Camera off air: forget the tracks so a returning person is a new track, not a stale one.
        tracker.reset();
        return { objects: [], framing: null };
      }
      const { objects } = await inner.detect(frame);
      const tracked = tracker.update(objects).map((t) => ({
        id: t.trackId, trackId: t.trackId, label: t.label, confidence: t.confidence, bbox: t.bbox,
      }));
      const f = framing(tracked);
      return { objects: tracked, framing: f ? { score: f.score, notes: f.notes.join('; ') } : null };
    },
    close: () => inner.close?.(),
  };
}
