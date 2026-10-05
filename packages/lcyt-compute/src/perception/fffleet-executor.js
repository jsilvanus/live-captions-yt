import { createPerceptionJob } from './job.js';
import { createDetector } from './backends.js';
import { createHttpFrameSource } from './frame-source.js';
import { createFfmpegFrameSource, createFallbackFrameSource } from './ffmpeg-frame-source.js';

/**
 * Perception as an fffleet job type, for `FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor`
 * on an fffleet worker (or `createFleet({ local: { executors } })`). The spec carries the plan in
 * `spec.perception`: `{ cameraId, apiKey, feedKind, frameUrl, streamUrl?, callbackUrl, internalToken, emitIntervalMs,
 * detectFps?, backend? }`.
 *
 * The detector is created first (ONNX model by default, see `backends.js`): a worker that lacks the
 * runtime or the model fails the job here with a readable error. With `streamUrl` the frames come
 * from an ffmpeg decode of the stream at `detectFps` (default 5), falling back to polling
 * `frameUrl` if the stream cannot be read; without it the snapshot at `frameUrl` is polled.
 * The job runs until it is cancelled; a camera or callback outage is retried by the runner.
 */
export async function runPerception(spec, rt) {
  const plan = spec.perception;
  if (!plan || typeof plan.frameUrl !== 'string') throw new Error('perception job needs spec.perception.frameUrl');
  const env = rt.env ?? process.env;
  const fetchImpl = rt.fetch ?? fetch;
  const backend = await createDetector(plan, env);
  let errors = 0;
  try {
    const snapshots = createHttpFrameSource(plan.frameUrl, { fetchImpl });
    let frameSource = snapshots;
    if (plan.streamUrl && backend.inputSize) {
      const stream = createFfmpegFrameSource({ url: plan.streamUrl, size: backend.inputSize, fps: plan.detectFps || 5 });
      frameSource = createFallbackFrameSource(stream, snapshots);
    }
    const job = createPerceptionJob(plan, spec.id, { fetchImpl, backend, frameSource, onJobError: () => { errors++; } });
    rt.setState('running');
    job.start();
    try {
      await new Promise((resolve) => rt.signal.addEventListener('abort', resolve, { once: true }));
    } finally {
      job.stop();
    }
  } finally {
    await backend.close?.();
  }
  rt.signal.throwIfAborted();
  return { exitCode: 0, outputs: [], stderrTail: errors ? `${errors} detect/callback errors` : null };
}

export default { type: 'perception', run: runPerception };
