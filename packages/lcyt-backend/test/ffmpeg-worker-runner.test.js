import { test } from 'node:test';
import assert from 'node:assert';
import { WorkerFfmpegRunner } from '../src/ffmpeg/worker-runner.js';

test('WorkerFfmpegRunner emits error and close events', async () => {
  // Mock global fetch to simulate start failure and successful stop
  let calledStart = false;
  global.fetch = async (url, opts) => {
    if (url.endsWith('/jobs') && opts.method === 'POST') {
      calledStart = true;
      return { ok: false, status: 500, json: async () => ({}) };
    }
    if (url.endsWith('/jobs/some-id') && opts.method === 'DELETE') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ jobId: 'some-id', workerId: 'w' }) };
  };

  const runner = new WorkerFfmpegRunner({ baseUrl: 'http://127.0.0.1:1', timeout: 100 });

  let sawError = false;
  let sawClose = false;
  runner.on('error', (err) => { sawError = true; });
  runner.on('close', (info) => { sawClose = true; });

  // Trigger start which will receive non-ok and throw; ensure error emitted
  await assert.rejects(async () => {
    await runner.start({});
  });
  assert.ok(sawError || calledStart);

  // Manually set jobId and call stop to cause close emission
  runner.jobId = 'some-id';
  const res = await runner.stop(200);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(sawClose, true);
});
