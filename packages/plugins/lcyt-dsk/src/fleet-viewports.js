import { viewportPageUrl, resolveCaptureDimensions, resolveCaptureBackground, buildViewportOutputs } from './renderer-helpers.js';

/**
 * Per-viewport DSK streams as fffleet `dsk` jobs (`DSK_RENDER_EXECUTOR=fleet` with `FFFLEET_URL`). Same inputs as
 * `startViewportStream` in renderer.js; Chromium and ffmpeg then run on a fleet worker instead of this process.
 * The job id is stable per key and viewport, so a backend restart that starts the stream again attaches to the job
 * the fleet already runs instead of starting a second one.
 *
 * The worker must reach the display page (`DSK_PAGE_BASE_URL` must not be localhost) and every RTMP URL.
 */
export function fleetRenderingEnabled(env = process.env) {
  return (env.DSK_RENDER_EXECUTOR || 'local').trim().toLowerCase() === 'fleet' && !!(env.FFFLEET_URL || env.COMPUTE_URL);
}

export function createFleetViewportRunner({ env = process.env, getFleet } = {}) {
  const running = new Map(); // `${apiKey}::${viewport}` -> { job, jobId }

  const fleetOf = async () => getFleet ? getFleet() : (await import('lcyt-compute/ffmpeg')).getFleet(env);
  const idOf = (apiKey, viewport) => `dsk-${`${apiKey}-${viewport}`.replace(/[^A-Za-z0-9_-]/g, '')}`;

  async function start(apiKey, opts) {
    const { slug = null, viewport, displaySettings = null, rtmpBase, rtmpApp = 'dsk', pushUrls = [] } = opts || {};
    if (!viewport || !rtmpBase) return null;
    const key = `${apiKey}::${viewport}`;
    if (running.has(key)) return { jobId: running.get(key).jobId, alreadyRunning: true };

    const pageBase = env.DSK_PAGE_BASE_URL || env.DSK_LOCAL_SERVER || '';
    if (/\/\/(localhost|127\.|\[::1\])/i.test(pageBase)) {
      throw new Error('DSK_PAGE_BASE_URL points at localhost; a fleet worker cannot reach it. Set it to the backend\'s public address.');
    }
    const { width, height } = resolveCaptureDimensions(opts.dimensions, displaySettings?.stream?.outputDimensions);
    const { background } = resolveCaptureBackground(displaySettings);
    const { targets } = buildViewportOutputs({ apiKey, viewport, rtmpBase, rtmpApp, pushUrls });
    const id = idOf(apiKey, viewport);
    const spec = {
      id, kind: 'stream', type: 'dsk', owner: apiKey, labels: { purpose: 'dsk' },
      dsk: { pageUrl: viewportPageUrl({ slug, apiKey, viewport, ...(pageBase ? { baseUrl: pageBase } : {}) }), width, height, background, fps: 25, outputs: targets.map(url => ({ url })) },
    };
    const job = await (await fleetOf()).submit(spec);
    const entry = { job, jobId: id };
    running.set(key, entry);
    job.done.then(() => { if (running.get(key) === entry) running.delete(key); }, () => { if (running.get(key) === entry) running.delete(key); });
    return { jobId: id };
  }

  async function stop(apiKey, viewport) {
    const key = `${apiKey}::${viewport}`;
    const entry = running.get(key);
    if (!entry) return false;
    running.delete(key);
    await entry.job.cancel();
    return true;
  }

  const has = (apiKey, viewport) => running.has(`${apiKey}::${viewport}`);
  const list = apiKey => [...running.keys()].filter(k => k.startsWith(`${apiKey}::`)).map(k => ({ viewport: k.slice(apiKey.length + 2), running: true, executor: 'fleet' }));

  return { start, stop, has, list };
}
