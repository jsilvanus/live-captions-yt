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
 * @param {{ purpose?: string, apiKey?: string, runner?: string, stop?: () => any }} info  `runner`: spawn | local | fleet;
 *   `stop` (optional) ends the process; only a run that has one can be cancelled (and only if its purpose is allow-listed
 *   in jobs-panel.js, see CANCELLABLE_PURPOSES).
 * @returns {() => void}
 */
export function trackFfmpegRun({ purpose = 'unknown', apiKey = '', runner = 'spawn', stop = null } = {}) {
  const id = `ffmpeg-${++_seq}`;
  _runs.set(id, { id, purpose, apiKey, runner, startedAt: Date.now(), stop: typeof stop === 'function' ? stop : null });
  return () => { _runs.delete(id); };
}

/** Running processes, oldest first: `{ id, purpose, apiKey, runner, startedAt (ms), stop }` (`stop` is a function or null). */
export function listRunningFfmpegRuns() {
  return [..._runs.values()].map((run) => ({ ...run })).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id, 'en', { numeric: true }));
}
