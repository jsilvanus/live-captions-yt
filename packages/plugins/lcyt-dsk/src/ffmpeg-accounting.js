/**
 * ffmpeg compute accounting sink (plan_metering_audit §4.1).
 *
 * The DSK renderer pipes Playwright frames into directly-spawned ffmpeg
 * processes (fragile pipeline — the plan pre-approves manual timing here
 * instead of migrating onto lcyt-backend's runner factory). The backend
 * injects its metrics handle via initDskControl. No-op when unset.
 */

let _sink = null;

/** @param {(entry: { purpose: string, apiKey: string, seconds: number }) => void} fn */
export function setFfmpegAccountingSink(fn) {
  _sink = typeof fn === 'function' ? fn : null;
}

export function reportFfmpegRun({ purpose = 'dsk', apiKey = '', seconds = 0 } = {}) {
  if (!(seconds > 0)) return;
  try {
    _sink?.({ purpose, apiKey, seconds });
  } catch {
    // Accounting must never break the pipeline.
  }
}
