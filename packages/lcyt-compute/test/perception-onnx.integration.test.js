import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../src/perception/backends.js';
import { createFfmpegFrameSource } from '../src/perception/ffmpeg-frame-source.js';

/**
 * Real model, real onnxruntime-node, real ffmpeg decode. Runs only when you point it at a model
 * and a clip with at least one person in view:
 *
 *   PERCEPTION_MODEL_PATH=yolox_tiny.onnx PERCEPTION_TEST_VIDEO=person.mp4 npm test -w packages/lcyt-compute
 */
const model = process.env.PERCEPTION_MODEL_PATH;
const video = process.env.PERCEPTION_TEST_VIDEO;
let runtime = true;
try { await import('onnxruntime-node'); } catch { runtime = false; }

test('a person in a decoded stream is detected with a plausible box', { skip: !(model && video && runtime) && 'set PERCEPTION_MODEL_PATH and PERCEPTION_TEST_VIDEO and install onnxruntime-node' }, async () => {
  const detector = await createDetector({}, process.env);
  const source = createFfmpegFrameSource({ url: video, size: detector.inputSize, fps: 5, inputArgs: ['-re', '-stream_loop', '-1'] });
  try {
    let found = null;
    for (let i = 0; i < 100 && !found; i++) {
      const frame = await source.getFrame();
      if (!frame) { await new Promise((r) => setTimeout(r, 100)); continue; }
      const { objects } = await detector.detect(frame);
      found = objects.find((o) => o.confidence > 0.5) ?? null;
    }
    assert.ok(found, 'a person was detected');
    const { x, y, w, h } = found.bbox;
    assert.ok(w > 0.02 && h > 0.05, 'box has a size');
    assert.ok(x >= 0 && y >= 0 && x + w <= 1.001 && y + h <= 1.001, 'box is inside the picture');
  } finally {
    source.close();
    await detector.close?.();
  }
});
