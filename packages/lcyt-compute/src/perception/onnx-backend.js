/**
 * Person detector backend: a YOLOX-class ONNX model on onnxruntime-node (CPU), in this process.
 *
 * Implements the runner's `{ detect(frame) }` contract. `onnxruntime-node` is an optional
 * dependency imported lazily: a worker without it, or without a model file, cannot create this
 * backend and the job fails with a readable error instead of reporting made-up detections.
 *
 * Frames are the letterboxed RGB frames of `ffmpeg-frame-source.js`; a plain JPEG Buffer (the
 * HTTP snapshot fallback) is decoded first. v1 detects people only (decision 4 of the plan).
 */

import { access } from 'node:fs/promises';
import { boxToNormalized } from './letterbox.js';
import { decodeJpegToFrame } from './jpeg-decode.js';
import { anchorCount, decodeCandidates, nms, rgbToTensor, PERSON_CLASS } from './yolox.js';

export const DEFAULT_INPUT_SIZE = 416;

/**
 * @param {{
 *   modelPath: string,
 *   inputSize?: number,
 *   confThreshold?: number,
 *   nmsThreshold?: number,
 *   threads?: number,
 *   ffmpegPath?: string,
 *   ort?: object,                // injected onnxruntime module (tests)
 * }} opts
 * @returns {Promise<{ detect: (frame: any) => Promise<{ objects: object[], framing: null }>, inputSize: number, close: () => Promise<void> }>}
 */
export async function createOnnxDetector({ modelPath, inputSize = DEFAULT_INPUT_SIZE, confThreshold = 0.35, nmsThreshold = 0.45, threads = 0, ffmpegPath, ort } = {}) {
  if (!modelPath) throw new Error('onnx perception backend needs a model (set PERCEPTION_MODEL_PATH)');
  try {
    await access(modelPath);
  } catch {
    throw new Error(`perception model not found: ${modelPath}`);
  }
  if (!ort) {
    try {
      ort = await import('onnxruntime-node');
    } catch (err) {
      throw new Error(`onnxruntime-node is not installed (${err.message}); install it on this worker or use PERCEPTION_BACKEND=stub for tests`);
    }
  }
  const runtime = ort.default ?? ort;
  const options = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };
  if (threads > 0) options.intraOpNumThreads = threads;
  const session = await runtime.InferenceSession.create(modelPath, options);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const expectedAnchors = anchorCount(inputSize);

  async function detect(frame) {
    if (!frame) return { objects: [], framing: null };
    const raw = Buffer.isBuffer(frame) ? await decodeJpegToFrame(frame, inputSize, { ffmpegPath }) : frame;
    if (raw.width !== inputSize || raw.height !== inputSize) throw new Error(`frame is ${raw.width}x${raw.height}, detector input is ${inputSize}`);
    const tensor = new runtime.Tensor('float32', rgbToTensor(raw.data, inputSize), [1, 3, inputSize, inputSize]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    const anchors = out.dims[out.dims.length - 2];
    const cols = out.dims[out.dims.length - 1];
    // Exports that already decode boxes (decode_in_inference) report pixel boxes: skip the grid step.
    const decode = anchors === expectedAnchors;
    const candidates = decodeCandidates(out.data, anchors, inputSize, { classes: cols - 5, classIndex: PERSON_CLASS, minScore: confThreshold, decode });
    const kept = nms(candidates, nmsThreshold);
    const objects = kept.map((c) => ({
      label: 'person',
      confidence: Math.round(c.score * 1000) / 1000,
      bbox: boxToNormalized(c, raw.letterbox),
    })).filter((o) => o.bbox.w > 0 && o.bbox.h > 0);
    return { objects, framing: null };
  }

  return { detect, inputSize, async close() { await session.release?.(); } };
}
