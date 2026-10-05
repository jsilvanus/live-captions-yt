import { createPerceptionJob } from './job.js';

/**
 * Perception as an fffleet job type, for `FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor`
 * on an fffleet worker (or `createFleet({ local: { executors } })`). The spec carries the plan in
 * `spec.perception`: `{ cameraId, apiKey, feedKind, frameUrl, callbackUrl, internalToken, emitIntervalMs }`.
 * The job runs until it is cancelled; a camera or callback outage is retried by the runner.
 */
export async function runPerception(spec, rt) {
  const plan = spec.perception;
  if (!plan || typeof plan.frameUrl !== 'string') throw new Error('perception job needs spec.perception.frameUrl');
  let errors = 0;
  const job = createPerceptionJob(plan, spec.id, { fetchImpl: rt.fetch ?? fetch, onJobError: () => { errors++; } });
  rt.setState('running');
  job.start();
  try {
    await new Promise((resolve) => rt.signal.addEventListener('abort', resolve, { once: true }));
  } finally {
    job.stop();
  }
  rt.signal.throwIfAborted();
  return { exitCode: 0, outputs: [], stderrTail: errors ? `${errors} detect/callback errors` : null };
}

export default { type: 'perception', run: runPerception };
