import { spawn } from 'node:child_process';
import { computeLetterbox, letterboxFilter } from './letterbox.js';

/**
 * Continuous frame source: ffmpeg decodes the camera stream and this keeps only the newest frame.
 *
 * The preview snapshot used by `createHttpFrameSource` refreshes about every 5 s, which makes
 * detections up to that old. Decoding the stream directly gives a frame a few hundred ms old at a
 * chosen rate. ffmpeg scales and pads each frame to the detector's square input (letterbox) and
 * writes raw RGB to stdout; a slow detector never queues frames, it just takes the newest one
 * (drop-old backpressure).
 *
 * Runs ffmpeg with a plain child process: the source lives inside the perception job, which on a
 * fleet already runs on the worker, so it must not be sent to the fleet again. A remote worker
 * must be able to reach `url` (an RTSP or RTMP address of the media server).
 *
 * getFrame() resolves to the newest frame, or null when none arrived in `maxAgeMs` (camera not
 * publishing: the runner reports it as not visible). A source that cannot start, after
 * `failuresBeforeError` attempts, makes getFrame() throw so the runner reports an error and a
 * fallback source can take over.
 */

/**
 * @param {{
 *   url: string,
 *   size: number,                  // detector input side (square)
 *   fps?: number,                  // decode rate
 *   maxAgeMs?: number,
 *   failuresBeforeError?: number,
 *   restartDelayMs?: number,
 *   inputArgs?: string[],          // extra input options (tests use ['-re', '-stream_loop', '-1'])
 *   ffmpegPath?: string,
 *   ffprobePath?: string,
 *   spawnImpl?: typeof spawn,
 *   onLog?: (line: string) => void,
 * }} opts
 */
export function createFfmpegFrameSource({
  url, size, fps = 5, maxAgeMs = 3000, failuresBeforeError = 3, restartDelayMs = 1000,
  inputArgs = [], ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', spawnImpl = spawn, onLog = () => {},
} = {}) {
  if (!url) throw new Error('ffmpeg frame source needs a url');
  if (!(size > 0)) throw new Error('ffmpeg frame source needs the detector input size');

  const transport = /^rtsp:/i.test(url) ? ['-rtsp_transport', 'tcp'] : [];
  const lowLatency = /^(rtsp|rtmp):/i.test(url) ? ['-fflags', 'nobuffer', '-flags', 'low_delay'] : [];
  const frameBytes = size * size * 3;

  let child = null;
  let stopped = true;
  let timer = null;
  let latest = null;
  let seq = 0;
  let failures = 0;
  let lastError = null;
  let starting = false;

  function probe() {
    return new Promise((resolve, reject) => {
      const p = spawnImpl(ffprobePath, ['-v', 'error', ...transport, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', url], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffprobe timed out')); }, 15000);
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { err += c; });
      p.on('error', (e) => { clearTimeout(t); reject(e); });
      p.on('close', () => {
        clearTimeout(t);
        const m = /^(\d+)x(\d+)/.exec(out.trim());
        if (!m) return reject(new Error(`ffprobe could not read the stream${err ? `: ${err.trim().slice(-200)}` : ''}`));
        resolve({ width: Number(m[1]), height: Number(m[2]) });
      });
    });
  }

  function scheduleRestart() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(run, Math.min(restartDelayMs * 2 ** Math.min(failures, 3), 8000));
  }

  async function run() {
    if (stopped || starting) return;
    starting = true;
    let dims;
    try {
      dims = await probe();
    } catch (err) {
      starting = false;
      failures++;
      lastError = err;
      onLog(`probe failed: ${err.message}`);
      return scheduleRestart();
    }
    starting = false;
    if (stopped) return;
    const lb = computeLetterbox(dims.width, dims.height, size);
    const args = ['-hide_banner', '-loglevel', 'error', ...transport, ...lowLatency, ...inputArgs, '-i', url, '-an',
      '-vf', `fps=${fps},${letterboxFilter(lb)}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
    const proc = spawnImpl(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    let buf = Buffer.alloc(0);
    let gotFrame = false;
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= frameBytes) {
        // Keep only the newest complete frame.
        latest = { data: Buffer.from(buf.subarray(0, frameBytes)), width: size, height: size, letterbox: lb, capturedAt: Date.now(), seq: ++seq };
        buf = buf.subarray(frameBytes);
        if (!gotFrame) { gotFrame = true; failures = 0; lastError = null; }
      }
    });
    proc.stderr.on('data', (c) => { stderr += c; if (stderr.length > 2000) stderr = stderr.slice(-2000); });
    proc.on('error', (err) => { failures++; lastError = err; });
    proc.on('close', (code) => {
      if (child === proc) child = null;
      if (stopped) return;
      if (!gotFrame) {
        failures++;
        lastError = new Error(`ffmpeg exited ${code} before the first frame${stderr ? `: ${stderr.trim().slice(-200)}` : ''}`);
      }
      onLog(`ffmpeg exited ${code}`);
      scheduleRestart();
    });
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    run();
  }

  return {
    async getFrame() {
      if (stopped) start();
      if (failures >= failuresBeforeError && lastError) throw lastError;
      if (!latest || Date.now() - latest.capturedAt > maxAgeMs) return null;
      return latest;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      child?.kill('SIGKILL');
      child = null;
      latest = null;
    },
  };
}

/**
 * Use `primary` until it fails `afterFailures` times in a row, then `secondary` for good.
 * (The preview-snapshot poll is the secondary source for the stream decoder.)
 */
export function createFallbackFrameSource(primary, secondary, { afterFailures = 2, onSwitch = () => {} } = {}) {
  let failures = 0;
  let usingSecondary = false;
  return {
    async getFrame() {
      if (usingSecondary) return secondary.getFrame();
      try {
        const frame = await primary.getFrame();
        failures = 0;
        return frame;
      } catch (err) {
        if (++failures >= afterFailures) {
          usingSecondary = true;
          primary.close?.();
          onSwitch(err);
          return secondary.getFrame();
        }
        throw err;
      }
    },
    close() { primary.close?.(); secondary.close?.(); },
  };
}
