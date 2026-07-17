/**
 * ffmpeg compute accounting sink (plan_metering_audit §4.1).
 *
 * lcyt-music spawns ffmpeg directly (music-manager RTMP analysis, pcm-extractor
 * HLS segment decode) rather than through lcyt-backend's runner factory, so the
 * backend injects its metrics handle here via initMusicControl. No-op when
 * unset — tests and standalone use stay unaffected.
 */

let _sink = null;

/** @param {(entry: { purpose: string, apiKey: string, seconds: number }) => void} fn */
export function setFfmpegAccountingSink(fn) {
  _sink = typeof fn === 'function' ? fn : null;
}

export function reportFfmpegRun({ purpose = 'unknown', apiKey = '', seconds = 0 } = {}) {
  if (!(seconds > 0)) return;
  try {
    _sink?.({ purpose, apiKey, seconds });
  } catch {
    // Accounting must never break the pipeline.
  }
}
