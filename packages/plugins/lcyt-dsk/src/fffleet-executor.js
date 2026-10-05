import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from './chromium.js';

/**
 * DSK viewport streaming as an fffleet job type, for
 * `FFFLEET_EXECUTORS=lcyt-dsk/fffleet-executor` on an fffleet worker. The spec carries the plan in `spec.dsk`:
 * `{ pageUrl, width, height, background, fps?, outputs: [{ url }] }`.
 *
 * The worker opens `pageUrl` (the display page of a viewport, served by the backend) in its own headless Chromium,
 * screenshots it at `fps` and pipes the frames into a local ffmpeg that pushes to every RTMP(S) URL in `outputs`
 * (one output, or an ffmpeg `tee` for several). The page keeps itself up to date through the backend's SSE stream, so
 * no overlay state travels with the job; the worker only has to reach `pageUrl` and the output URLs. The job runs
 * until it is cancelled; a crashed Chromium or ffmpeg fails it.
 */
export function buildEncodeArgs({ fps, outputs }) {
  const urls = outputs.map(o => o.url);
  const output = urls.length > 1 ? ['-f', 'tee', urls.map(u => `[f=flv]${u}`).join('|')] : ['-f', 'flv', urls[0]];
  return [
    '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
    '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-g', String(fps * 2),
    ...output,
  ];
}

function readPlan(spec) {
  const plan = spec.dsk;
  if (!plan || typeof plan.pageUrl !== 'string' || !/^https?:\/\//i.test(plan.pageUrl)) throw new Error('dsk job needs spec.dsk.pageUrl (http or https)');
  const outputs = (Array.isArray(plan.outputs) ? plan.outputs : []).filter(o => o && /^rtmps?:\/\//i.test(String(o.url || '')));
  if (!outputs.length) throw new Error('dsk job needs at least one rtmp(s):// URL in spec.dsk.outputs');
  const fps = Math.min(30, Math.max(1, Math.round(Number(plan.fps) || 25)));
  return { pageUrl: plan.pageUrl, width: Math.round(Number(plan.width)) || 1920, height: Math.round(Number(plan.height)) || 1080, background: plan.background || '#00B140', fps, outputs };
}

export async function runDsk(spec, rt, deps = {}) {
  const plan = readPlan(spec);
  const env = rt.env ?? process.env;
  const launch = deps.launch ?? (opts => chromium.launch(opts));
  const spawnImpl = deps.spawn ?? spawn;
  const executablePath = 'executablePath' in deps ? deps.executablePath : resolveChromiumExecutable(env);
  if (!executablePath) throw new Error('no Chromium found on this worker (set PLAYWRIGHT_DSK_CHROMIUM)');

  const browser = await launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  let ffmpeg = null;
  let stderrTail = '';
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: plan.width, height: plan.height });
    await page.goto(plan.pageUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(bg => { document.documentElement.style.background = bg; document.body.style.background = bg; }, plan.background).catch(() => {});

    ffmpeg = spawnImpl(env.FFMPEG_PATH || 'ffmpeg', buildEncodeArgs(plan), { stdio: ['pipe', 'ignore', 'pipe'] });
    ffmpeg.stderr?.on('data', b => { stderrTail = (stderrTail + b.toString()).slice(-2000); });
    const exited = new Promise(resolve => ffmpeg.once('exit', (code, signal) => resolve({ code, signal })));
    ffmpeg.stdin.on('error', () => {}); // an ffmpeg that died shows up through `exited`

    rt.setState('running');
    const interval = Math.floor(1000 / plan.fps);
    let ended = null;
    exited.then(e => { ended = e; });
    while (!rt.signal.aborted && !ended) {
      const t0 = Date.now();
      const frame = await page.screenshot({ type: 'png' });
      if (rt.signal.aborted || ended) break;
      if (!ffmpeg.stdin.write(frame)) await Promise.race([new Promise(r => ffmpeg.stdin.once('drain', r)), exited]);
      const wait = interval - (Date.now() - t0);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { ffmpeg.stdin.end(); } catch { /* already closed */ }
    if (ended && !rt.signal.aborted) {
      throw new Error(`ffmpeg exited (code=${ended.code}, signal=${ended.signal}): ${stderrTail.trim().split('\n').slice(-3).join(' | ')}`);
    }
  } finally {
    if (ffmpeg && ffmpeg.exitCode === null) { try { ffmpeg.kill('SIGTERM'); } catch { /* gone */ } }
    await browser.close().catch(() => {});
  }
  rt.signal.throwIfAborted();
  return { exitCode: 0, outputs: [], stderrTail: stderrTail.trim() || null };
}

export default { type: 'dsk', run: runDsk };
