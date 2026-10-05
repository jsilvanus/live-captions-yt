import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runDsk, buildEncodeArgs } from '../src/fffleet-executor.js';
import { createFleetViewportRunner, fleetRenderingEnabled } from '../src/fleet-viewports.js';

function fakeRt() {
  const ac = new AbortController();
  const states = [];
  return { signal: ac.signal, abort: () => ac.abort(), setState: s => states.push(s), states, env: {} };
}

function fakeBrowser(log) {
  const page = {
    setViewportSize: async v => log.push(['size', v]),
    goto: async (url, o) => log.push(['goto', url]),
    evaluate: async () => {},
    screenshot: async () => Buffer.from('png'),
  };
  return { newPage: async () => page, close: async () => log.push(['closed']) };
}

function fakeFfmpeg(log, { dieAfterMs = null } = {}) {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdin.on('data', d => log.push(['frame', d.length]));
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.kill = () => { proc.exitCode = 0; proc.emit('exit', 0, 'SIGTERM'); };
  if (dieAfterMs) setTimeout(() => { proc.stderr.write('rtmp refused\n'); proc.exitCode = 1; proc.emit('exit', 1, null); }, dieAfterMs);
  return proc;
}

describe('dsk fffleet executor', () => {
  it('builds single and tee outputs', () => {
    assert.deepEqual(buildEncodeArgs({ fps: 25, outputs: [{ url: 'rtmp://a/x' }] }).slice(-3), ['-f', 'flv', 'rtmp://a/x']);
    const tee = buildEncodeArgs({ fps: 25, outputs: [{ url: 'rtmp://a/x' }, { url: 'rtmps://b/y' }] });
    assert.deepEqual(tee.slice(-2), ['tee', '[f=flv]rtmp://a/x|[f=flv]rtmps://b/y']);
  });

  it('rejects incomplete plans', async () => {
    await assert.rejects(runDsk({ dsk: { pageUrl: 'file:///x', outputs: [] } }, fakeRt(), {}), /pageUrl/);
    await assert.rejects(runDsk({ dsk: { pageUrl: 'https://x/dsk/k/v', outputs: [{ url: 'http://no' }] } }, fakeRt(), {}), /rtmp/);
  });

  it('captures frames into ffmpeg until cancelled', async () => {
    const log = [];
    const rt = fakeRt();
    const spec = { dsk: { pageUrl: 'https://backend/dsk/k/v', width: 1280, height: 720, fps: 30, outputs: [{ url: 'rtmp://m/live/k' }] } };
    const p = runDsk(spec, rt, { executablePath: '/bin/chromium', launch: async () => fakeBrowser(log), spawn: () => fakeFfmpeg(log) });
    await new Promise(r => setTimeout(r, 150));
    rt.abort();
    await assert.rejects(p, e => e.name === 'AbortError' || /abort/i.test(String(e.message)));
    assert.deepEqual(rt.states, ['running']);
    assert.ok(log.some(l => l[0] === 'goto' && l[1] === 'https://backend/dsk/k/v'));
    assert.deepEqual(log.find(l => l[0] === 'size')[1], { width: 1280, height: 720 });
    assert.ok(log.filter(l => l[0] === 'frame').length >= 2, 'wrote frames');
    assert.ok(log.some(l => l[0] === 'closed'), 'browser closed');
  });

  it('fails the job with the ffmpeg reason when ffmpeg dies', async () => {
    const log = [];
    const spec = { dsk: { pageUrl: 'https://backend/dsk/k/v', outputs: [{ url: 'rtmp://m/live/k' }] } };
    await assert.rejects(
      runDsk(spec, fakeRt(), { executablePath: '/bin/chromium', launch: async () => fakeBrowser(log), spawn: () => fakeFfmpeg(log, { dieAfterMs: 60 }) }),
      /ffmpeg exited \(code=1.*rtmp refused/s,
    );
    assert.ok(log.some(l => l[0] === 'closed'));
  });

  it('fails clearly without Chromium', async () => {
    await assert.rejects(runDsk({ dsk: { pageUrl: 'https://x/', outputs: [{ url: 'rtmp://m/a' }] } }, fakeRt(), { executablePath: null, launch: async () => { throw new Error('unused'); } }), /no Chromium/);
  });
});

describe('dsk fleet viewport runner', () => {
  const env = { DSK_RENDER_EXECUTOR: 'fleet', FFFLEET_URL: 'http://fleet', DSK_PAGE_BASE_URL: 'https://lcyt.example' };

  function fakeFleet() {
    const submitted = [];
    let cancelled = 0;
    let finish;
    const job = { done: new Promise(r => { finish = r; }), cancel: async () => { cancelled++; finish(); } };
    return { submitted, get cancelled() { return cancelled; }, finish: () => finish(), fleet: { submit: async spec => { submitted.push(spec); return job; } } };
  }

  it('is off unless asked for and configured', () => {
    assert.equal(fleetRenderingEnabled({}), false);
    assert.equal(fleetRenderingEnabled({ DSK_RENDER_EXECUTOR: 'fleet' }), false);
    assert.equal(fleetRenderingEnabled(env), true);
  });

  it('submits a stable dsk job, is idempotent and cancels on stop', async () => {
    const f = fakeFleet();
    const r = createFleetViewportRunner({ env, getFleet: async () => f.fleet });
    const opts = { slug: 'church', viewport: 'main', dimensions: { width: 1920, height: 1080 }, displaySettings: { background: '#112233' }, rtmpBase: 'rtmp://ingest', pushUrls: [{ url: 'rtmps://yt/live2/abc' }] };
    const a = await r.start('key1', opts);
    const b = await r.start('key1', opts);
    assert.equal(b.alreadyRunning, true);
    assert.equal(f.submitted.length, 1);
    const spec = f.submitted[0];
    assert.equal(spec.type, 'dsk');
    assert.equal(spec.id, a.jobId);
    assert.equal(spec.kind, 'stream');
    assert.equal(spec.dsk.pageUrl, 'https://lcyt.example/dsk/church/main');
    assert.equal(spec.dsk.background, '#112233');
    assert.deepEqual(spec.dsk.outputs.map(o => o.url), ['rtmp://ingest/dsk/key1__main', 'rtmps://yt/live2/abc']);
    assert.deepEqual(r.list('key1'), [{ viewport: 'main', running: true, executor: 'fleet' }]);
    assert.equal(await r.stop('key1', 'main'), true);
    assert.equal(f.cancelled, 1);
    assert.deepEqual(r.list('key1'), []);
    assert.equal(await r.stop('key1', 'main'), false);
  });

  it('forgets a job that ends by itself', async () => {
    const f = fakeFleet();
    const r = createFleetViewportRunner({ env, getFleet: async () => f.fleet });
    await r.start('k', { viewport: 'v', rtmpBase: 'rtmp://i' });
    f.finish();
    await new Promise(r2 => setTimeout(r2, 5));
    assert.equal(r.has('k', 'v'), false);
  });

  it('refuses a localhost page address a worker could not reach', async () => {
    const r = createFleetViewportRunner({ env: { ...env, DSK_PAGE_BASE_URL: 'http://localhost:3000' }, getFleet: async () => fakeFleet().fleet });
    await assert.rejects(r.start('k', { viewport: 'v', rtmpBase: 'rtmp://i' }), /localhost/);
  });
});
