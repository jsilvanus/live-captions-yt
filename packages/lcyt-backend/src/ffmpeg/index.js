import { LocalFfmpegRunner } from './local-runner.js';
import { DockerFfmpegRunner } from './docker-runner.js';
import { WorkerFfmpegRunner } from './worker-runner.js';

/**
 * Runner interface (async):
 * - start(): Promise<RunnerHandle>
 * - RunnerHandle is an EventEmitter-like object with optional `stdout` and `stderr` streams
 * - RunnerHandle.stop(timeoutMs): Promise<{ code?: number|null, signal?: string|null, timedOut: boolean }>
 * - RunnerHandle emits 'error' and 'close' events (close receives code or { code, signal })
 *
 * Notes: start() should be awaited by callers (managers) to receive the RunnerHandle before
 * attaching listeners. stop(timeoutMs) must enforce a timeout and return an object that
 * explicitly indicates whether the stop timed out.
 */

// Environment-driven defaults
const ENV_RUNNER = process.env.FFMPEG_RUNNER || 'spawn';
const ENV_IMAGE = process.env.FFMPEG_IMAGE || 'lcyt-ffmpeg:latest';
const ENV_WRAPPER = process.env.FFMPEG_WRAPPER || '';

// ---------------------------------------------------------------------------
// ffmpeg compute accounting (plan_metering_audit §4.1)
//
// Wall-clock process-seconds × purpose label, reported once per finished
// process to a module-level sink set by server.js. No-op when unset (tests,
// CLI). The factory is the single choke point: every runner started through
// createFfmpegRunner is timed, regardless of FFMPEG_RUNNER backend.
// ---------------------------------------------------------------------------

let _accountingSink = null;

/** @param {(entry: { purpose: string, apiKey: string, seconds: number }) => void} fn */
export function setFfmpegAccountingSink(fn) {
  _accountingSink = typeof fn === 'function' ? fn : null;
}

// Live tally of factory-started ffmpeg processes by purpose, for the
// /admin/metrics/live panel. Directly-spawned processes (stt/hls/music/dsk
// manual-timing sites) are not included here.
const _running = new Map();

export function getRunningFfmpegCounts() {
  return Object.fromEntries(_running);
}

/** Directly report a manually-timed ffmpeg run (DSK renderer fallback path). */
export function reportFfmpegRun({ purpose = 'unknown', apiKey = '', seconds = 0 } = {}) {
  if (!(seconds > 0)) return;
  try {
    _accountingSink?.({ purpose, apiKey, seconds });
  } catch {
    // Accounting must never break the pipeline.
  }
}

function wrapRunnerAccounting(runner, purpose, apiKey) {
  const originalStart = runner.start.bind(runner);
  runner.start = async (...args) => {
    const handle = await originalStart(...args);
    const startedAt = Date.now();
    _running.set(purpose, (_running.get(purpose) || 0) + 1);
    let reported = false;
    const report = () => {
      if (reported) return;
      reported = true;
      const count = (_running.get(purpose) || 1) - 1;
      if (count > 0) _running.set(purpose, count);
      else _running.delete(purpose);
      reportFfmpegRun({ purpose, apiKey, seconds: (Date.now() - startedAt) / 1000 });
    };
    handle.on?.('close', report);
    handle.on?.('error', report);
    return handle;
  };
  return runner;
}

export function createFfmpegRunner({ runner = ENV_RUNNER, purpose = 'unknown', apiKey = '', ...opts } = {}) {
  const withAccounting = (instance) => wrapRunnerAccounting(instance, purpose, apiKey);

  // Backwards-compatible: if a wrapper command is provided via env, prefer it
  if (!opts.cmd && ENV_WRAPPER) {
    return withAccounting(new LocalFfmpegRunner(Object.assign({}, opts, { cmd: ENV_WRAPPER })));
  }

  switch (runner) {
    case 'spawn':
    case 'local':
      return withAccounting(new LocalFfmpegRunner(opts));
    case 'docker':
      // ensure image default is taken from env when not provided
      return withAccounting(new DockerFfmpegRunner(Object.assign({ image: ENV_IMAGE }, opts)));
    case 'worker':
      return withAccounting(new WorkerFfmpegRunner(opts));
    default:
      throw new Error(`Unknown ffmpeg runner: ${runner}`);
  }
}

export { LocalFfmpegRunner, DockerFfmpegRunner, WorkerFfmpegRunner };
