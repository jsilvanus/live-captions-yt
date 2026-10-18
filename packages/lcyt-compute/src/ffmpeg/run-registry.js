/**
 * Registry of running ffmpeg processes (one entry per process, from start until it
 * closes), for read-only listings such as the jobs panel (`GET /compute/jobs` in
 * lcyt-backend). Holds no secrets beyond the `apiKey` label the caller passed in; the
 * backend decides who may see which entry. Module-level state, like the accounting sink.
 */

let _seq = 0;
const _runs = new Map();

/**
 * Registers a started process. Call the returned function when it ended (idempotent).
 * @param {{ purpose?: string, apiKey?: string, runner?: string }} info  `runner`: spawn | local | fleet
 * @returns {() => void}
 */
export function trackFfmpegRun({ purpose = 'unknown', apiKey = '', runner = 'spawn' } = {}) {
  const id = `ffmpeg-${++_seq}`;
  _runs.set(id, { id, purpose, apiKey, runner, startedAt: Date.now() });
  return () => { _runs.delete(id); };
}

/** Running processes, oldest first: `{ id, purpose, apiKey, runner, startedAt (ms) }`. */
export function listRunningFfmpegRuns() {
  return [..._runs.values()].map((run) => ({ ...run })).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id, 'en', { numeric: true }));
}
