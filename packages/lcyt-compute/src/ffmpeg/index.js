import { LocalFfmpegRunner } from './local-runner.js';
import { FleetFfmpegRunner } from './fleet-runner.js';
import { trackFfmpegRun } from './run-registry.js';

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

function wrapRunnerAccounting(runner, purpose, apiKey, kind) {
  const originalStart = runner.start.bind(runner);
  runner.start = async (...args) => {
    const handle = await originalStart(...args);
    const startedAt = Date.now();
    _running.set(purpose, (_running.get(purpose) || 0) + 1);
    const untrack = trackFfmpegRun({ purpose, apiKey, runner: kind, stop: () => runner.stop() });
    let reported = false;
    const report = () => {
      if (reported) return;
      reported = true;
      untrack();
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

let _warnedDocker = false;

export function createFfmpegRunner({ runner = ENV_RUNNER, purpose = 'unknown', apiKey = '', ...opts } = {}) {
  const withAccounting = (instance, kind = 'spawn') => wrapRunnerAccounting(instance, purpose, apiKey, kind);

  // Backwards-compatible: if a wrapper command is provided via env, prefer it (callers that
  // pass the plain 'ffmpeg' still get the wrapper; only a custom cmd overrides it)
  if ((!opts.cmd || opts.cmd === 'ffmpeg') && ENV_WRAPPER) {
    return withAccounting(new LocalFfmpegRunner(Object.assign({}, opts, { cmd: ENV_WRAPPER })), 'local');
  }

  switch (runner) {
    case 'spawn':
    case 'local':
      return withAccounting(new LocalFfmpegRunner(opts), runner);
    case 'docker':
      // The program no longer starts containers itself; only spawn and fleet remain.
      if (!_warnedDocker) {
        _warnedDocker = true;
        console.warn("[ffmpeg] FFMPEG_RUNNER=docker was removed; running ffmpeg with 'spawn'. Use FFMPEG_RUNNER=fleet to run it on an fffleet fleet.");
      }
      return withAccounting(new LocalFfmpegRunner(opts));
    case 'fleet':
      return withAccounting(new FleetFfmpegRunner(opts), 'fleet');
    case 'worker':
      throw new Error("FFMPEG_RUNNER=worker was removed together with lcyt-worker-daemon and lcyt-orchestrator; use FFMPEG_RUNNER=fleet with FFFLEET_URL (https://github.com/jsilvanus/fffleet)");
    default:
      throw new Error(`Unknown ffmpeg runner: ${runner}`);
  }
}

export { LocalFfmpegRunner, FleetFfmpegRunner };
export { getFleet, closeFleet } from './fleet-runner.js';
export { spawnFfmpeg } from './spawn.js';
export { trackFfmpegRun, listRunningFfmpegRuns } from './run-registry.js';
