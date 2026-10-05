import { createStubDetector } from './stub-backend.js';
import { createOnnxDetector, DEFAULT_INPUT_SIZE } from './onnx-backend.js';
import { createTrackedDetector } from './tracked-detector.js';

/**
 * Pick the detector for a perception job.
 *
 * `plan.backend`, else `PERCEPTION_BACKEND`, else `onnx`. There is deliberately no silent fallback
 * to the stub: a worker without the runtime or the model fails the job with a readable error,
 * because invented people would feed cue rules and the camera follow. `stub` is for tests and demos.
 *
 * Environment: PERCEPTION_BACKEND (`onnx` | `stub`), PERCEPTION_MODEL_PATH, PERCEPTION_INPUT_SIZE
 * (default 416, the YOLOX nano/tiny size), PERCEPTION_CONF_THRESHOLD, PERCEPTION_THREADS,
 * PERCEPTION_TRACKING (`0` = raw detections without track ids and framing score).
 *
 * The onnx detector is wrapped with the tracker and the framing score (`tracked-detector.js`), so
 * objects carry a stable `trackId` and the job reports `framing`.
 *
 * @param {{ backend?: string, modelPath?: string, inputSize?: number, confThreshold?: number }} [plan]
 * @param {object} [env]
 * @param {{ ort?: object }} [deps]
 * @returns {Promise<{ detect: Function, inputSize?: number, close?: Function }>}
 */
export async function createDetector(plan = {}, env = process.env, deps = {}) {
  const kind = plan.backend || env.PERCEPTION_BACKEND || 'onnx';
  if (kind === 'stub') return createStubDetector();
  if (kind !== 'onnx') throw new Error(`unknown perception backend "${kind}" (use onnx or stub)`);
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  const onnx = await createOnnxDetector({
    modelPath: plan.modelPath || env.PERCEPTION_MODEL_PATH,
    inputSize: plan.inputSize || num(env.PERCEPTION_INPUT_SIZE) || DEFAULT_INPUT_SIZE,
    confThreshold: plan.confThreshold ?? num(env.PERCEPTION_CONF_THRESHOLD),
    threads: num(env.PERCEPTION_THREADS) || 0,
    ort: deps.ort,
  });
  const tracking = plan.tracking ?? (env.PERCEPTION_TRACKING !== '0');
  return tracking ? createTrackedDetector(onnx) : onnx;
}
