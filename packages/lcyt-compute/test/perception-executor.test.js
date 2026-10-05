import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFleet } from 'fffleet';
import executor from '../src/perception/fffleet-executor.js';

test('a perception job polls the frame url, posts detections to the callback and ends on cancel', async () => {
  const posts = [];
  const server = createServer((req, res) => {
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { posts.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }); res.end('{}'); });
    } else {
      res.statusCode = 404; // camera not publishing: the runner still emits "not visible"
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fleet = createFleet({ local: { executors: { [executor.type]: executor.run } } });
  try {
    const job = await fleet.submit({
      id: 'perception-test', kind: 'stream', type: 'perception',
      perception: { cameraId: 'cam-1', apiKey: 'key1', feedKind: 'dedicated', frameUrl: `${base}/frame`, callbackUrl: `${base}/ingest`, internalToken: 'tok', emitIntervalMs: 200 },
    });
    for (let i = 0; i < 100 && posts.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(posts.length > 0, 'a detection was posted');
    assert.equal(posts[0].headers['x-internal-auth'], 'tok');
    assert.equal(posts[0].body.apiKey, 'key1');
    assert.equal(posts[0].body.cameraId, 'cam-1');
    await job.cancel();
    assert.equal((await job.done).state, 'cancelled');
  } finally {
    await fleet.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a perception job without a frame url fails', async () => {
  const fleet = createFleet({ local: { executors: { [executor.type]: executor.run } } });
  const job = await fleet.submit({ id: 'perception-bad', kind: 'stream', type: 'perception', perception: {} });
  assert.equal((await job.done).state, 'failed');
  await fleet.close();
});
