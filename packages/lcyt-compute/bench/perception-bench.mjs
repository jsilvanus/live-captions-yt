#!/usr/bin/env node
/**
 * Perception benchmark (plan phase 0): how fast can this machine decode a camera stream and run the
 * person detector, and how old is a frame by the time its detection is ready?
 *
 *   node packages/lcyt-compute/bench/perception-bench.mjs --model yolox_tiny.onnx --video clip.mp4
 *   node packages/lcyt-compute/bench/perception-bench.mjs --model m.onnx --video rtsp://mediamtx:8554/cam1 --fps 10 --seconds 60 --threads 2
 *
 * Options: --model (or PERCEPTION_MODEL_PATH), --video (file or stream url), --input-size 416,
 * --fps 5 (decode rate), --seconds 30, --threads 0 (onnxruntime intra-op threads, 0 = default),
 * --loop (loop a file, on by default for files; pass --no-loop to stop at the end).
 * Prints one JSON line with decode and inference figures, so runs on different machines compare.
 */
import { parseArgs } from 'node:util';
import { cpus } from 'node:os';
import { createDetector } from '../src/perception/backends.js';
import { createFfmpegFrameSource } from '../src/perception/ffmpeg-frame-source.js';

const { values } = parseArgs({
  options: {
    model: { type: 'string' }, video: { type: 'string' }, 'input-size': { type: 'string', default: '416' },
    fps: { type: 'string', default: '5' }, seconds: { type: 'string', default: '30' }, threads: { type: 'string', default: '0' },
    'no-loop': { type: 'boolean', default: false },
  },
});
if (!values.video) { console.error('--video is required (file or stream url)'); process.exit(2); }

const env = { ...process.env, PERCEPTION_THREADS: values.threads };
const detector = await createDetector({ modelPath: values.model, inputSize: Number(values['input-size']) }, env);
const isStream = /^[a-z]+:\/\//i.test(values.video);
const source = createFfmpegFrameSource({
  url: values.video, size: detector.inputSize ?? 416, fps: Number(values.fps),
  inputArgs: !isStream && !values['no-loop'] ? ['-re', '-stream_loop', '-1'] : [],
});

const inference = [];
const age = [];
const persons = [];
let lastSeq = 0;
let frames = 0;
const startedAt = Date.now();
const until = startedAt + Number(values.seconds) * 1000;
while (Date.now() < until) {
  const frame = await source.getFrame().catch((err) => { console.error(err.message); return null; });
  if (!frame || frame.seq === lastSeq) { await new Promise((r) => setTimeout(r, 10)); continue; }
  lastSeq = frame.seq;
  frames++;
  const t = performance.now();
  const { objects } = await detector.detect(frame);
  inference.push(performance.now() - t);
  age.push(Date.now() - frame.capturedAt);
  persons.push(objects.length);
}
source.close();
await detector.close?.();

const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null);
const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
const elapsed = (Date.now() - startedAt) / 1000;
console.log(JSON.stringify({
  machine: { cpus: cpus().length, model: cpus()[0]?.model },
  config: { video: values.video, inputSize: detector.inputSize ?? 416, decodeFps: Number(values.fps), threads: Number(values.threads) },
  seconds: round(elapsed),
  detections: frames,
  detectionsPerSecond: round(frames / elapsed),
  inferenceMs: { p50: round(pct(inference, 0.5)), p95: round(pct(inference, 0.95)), max: round(Math.max(...inference)) },
  frameAgeMsAtResult: { p50: round(pct(age, 0.5)), p95: round(pct(age, 0.95)), max: round(Math.max(...age)) },
  personsPerFrameMean: round(persons.reduce((a, b) => a + b, 0) / Math.max(1, persons.length)),
}));
