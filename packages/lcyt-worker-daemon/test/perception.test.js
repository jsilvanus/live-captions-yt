import { test } from 'node:test';
import assert from 'node:assert';

process.env.NODE_ENV = 'test';

const { startServer } = await import('../src/index.js');
const { createHttpFrameSource } = await import('../src/perception/frame-source.js');
const { createStubDetector } = await import('../src/perception/stub-backend.js');
const { createPerceptionRunner } = await import('../src/perception/runner.js');

const realFetch = global.fetch;

test('perception/frame-source: returns a Buffer on 200, null on non-ok or error', async () => {
  global.fetch = async (url) => {
    if (url === 'http://x/ok') return { ok: true, arrayBuffer: async () => Buffer.from('jpeg-bytes') };
    if (url === 'http://x/missing') return { ok: false };
    throw new Error('network down');
  };
  try {
    const ok = createHttpFrameSource('http://x/ok');
    assert.deepStrictEqual(await ok.getFrame(), Buffer.from('jpeg-bytes'));

    const missing = createHttpFrameSource('http://x/missing');
    assert.strictEqual(await missing.getFrame(), null);

    const broken = createHttpFrameSource('http://x/error');
    assert.strictEqual(await broken.getFrame(), null);

    const noUrl = createHttpFrameSource(null);
    assert.strictEqual(await noUrl.getFrame(), null);
  } finally {
    global.fetch = realFetch;
  }
});

test('perception/stub-backend: no frame -> empty detections; frame -> one deterministic object', async () => {
  const detector = createStubDetector();
  assert.deepStrictEqual(await detector.detect(null), { objects: [], framing: null });

  const result = await detector.detect(Buffer.from('frame'));
  assert.strictEqual(result.objects.length, 1);
  assert.strictEqual(result.objects[0].label, 'person');
  assert.ok(result.framing);
});

test('perception/runner: ticks on an interval, reports visible based on frame presence, stop() halts it', async () => {
  let frameCount = 0;
  const frameSource = { getFrame: async () => (frameCount++ % 2 === 0 ? Buffer.from('f') : null) };
  const backend = { detect: async (frame) => ({ objects: frame ? [{ id: '1', label: 'x', confidence: 0.5, bbox: {} }] : [], framing: null }) };
  const detections = [];
  const runner = createPerceptionRunner('cam-1', frameSource, {
    emitIntervalMs: 50,
    backend,
    onDetection: (d) => detections.push(d),
  });

  runner.start();
  await new Promise((r) => setTimeout(r, 220));
  runner.stop();
  const countAtStop = detections.length;
  assert.ok(countAtStop >= 2, `expected at least 2 ticks, got ${countAtStop}`);
  assert.strictEqual(detections[0].cameraId, 'cam-1');
  assert.strictEqual(detections[0].visible, true);
  assert.strictEqual(detections[1].visible, false);

  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(detections.length, countAtStop, 'no further ticks after stop()');
});

test('POST /jobs with type=perception starts a job and POSTs detections to the callback URL; DELETE stops it', async (t) => {
  const { server, stop } = startServer(0);
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  const callbacks = [];
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.startsWith(base)) return realFetch(url, init);
    if (url === 'http://frame.test/incoming') {
      return { ok: true, arrayBuffer: async () => Buffer.from('jpeg') };
    }
    if (url === 'http://backend.test/production/perception/ingest') {
      callbacks.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected fetch to ${url}`);
  };

  t.after(async () => {
    global.fetch = realFetch;
    await stop();
  });

  const plan = {
    id: 'perc-job-1',
    type: 'perception',
    apiKey: 'key1',
    cameraId: 'cam-1',
    frameUrl: 'http://frame.test/incoming',
    callbackUrl: 'http://backend.test/production/perception/ingest',
    internalToken: 'shh',
    emitIntervalMs: 60,
  };

  const startRes = await fetch(`${base}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
  });
  assert.strictEqual(startRes.status, 200);
  const { jobId } = await startRes.json();
  assert.strictEqual(jobId, 'perc-job-1');

  await new Promise((r) => setTimeout(r, 200));
  assert.ok(callbacks.length >= 2, `expected at least 2 callback POSTs, got ${callbacks.length}`);
  assert.strictEqual(callbacks[0].apiKey, 'key1');
  assert.strictEqual(callbacks[0].cameraId, 'cam-1');
  assert.ok(Array.isArray(callbacks[0].objects));

  const delRes = await fetch(`${base}/jobs/${jobId}`, { method: 'DELETE' });
  assert.strictEqual(delRes.status, 200);

  const countAtStop = callbacks.length;
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(callbacks.length, countAtStop, 'no further callbacks after DELETE /jobs/:id');
});
