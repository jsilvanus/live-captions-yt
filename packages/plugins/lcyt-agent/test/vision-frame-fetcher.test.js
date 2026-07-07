import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { VisionFrameFetcher } from '../src/vision-frame-fetcher.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('VisionFrameFetcher', () => {
  test('polls the preview endpoint URL for the given apiKey', () => {
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', previewBaseUrl: 'http://localhost:3000' });
    assert.equal(fetcher._url, 'http://localhost:3000/preview/key1/incoming');
    fetcher.stop();
  });

  test('emits "frame" with a Buffer on a successful fetch', async () => {
    global.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('jpeg-bytes') });
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', pollIntervalMs: 100000, previewBaseUrl: 'http://x' });
    const framePromise = new Promise((resolve) => fetcher.once('frame', resolve));
    fetcher.start();
    const frame = await framePromise;
    assert.ok(Buffer.isBuffer(frame));
    assert.equal(frame.toString(), 'jpeg-bytes');
    fetcher.stop();
  });

  test('a 404 (no preview yet) is silently skipped, not an error', async () => {
    global.fetch = async () => ({ ok: false, status: 404 });
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', pollIntervalMs: 100000, previewBaseUrl: 'http://x' });
    let errored = false;
    fetcher.on('error', () => { errored = true; });
    fetcher.start();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(errored, false);
    fetcher.stop();
  });

  test('a non-404 non-ok response emits "error"', async () => {
    global.fetch = async () => ({ ok: false, status: 502 });
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', pollIntervalMs: 100000, previewBaseUrl: 'http://x' });
    const errorPromise = new Promise((resolve) => fetcher.once('error', resolve));
    fetcher.start();
    const err = await errorPromise;
    assert.match(err.message, /502/);
    fetcher.stop();
  });

  test('a fetch rejection emits "error" rather than throwing', async () => {
    global.fetch = async () => { throw new Error('network down'); };
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', pollIntervalMs: 100000, previewBaseUrl: 'http://x' });
    const errorPromise = new Promise((resolve) => fetcher.once('error', resolve));
    fetcher.start();
    const err = await errorPromise;
    assert.match(err.message, /network down/);
    fetcher.stop();
  });

  test('stop() halts polling and running becomes false', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') }; };
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', pollIntervalMs: 15, previewBaseUrl: 'http://x' });
    fetcher.start();
    await new Promise((r) => setTimeout(r, 40));
    fetcher.stop();
    assert.equal(fetcher.running, false);
    const callsAtStop = calls;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, callsAtStop, 'no further polls after stop()');
  });

  test('start() is idempotent — calling twice does not double the interval', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') }; };
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', pollIntervalMs: 20, previewBaseUrl: 'http://x' });
    fetcher.start();
    fetcher.start();
    await new Promise((r) => setTimeout(r, 50));
    fetcher.stop();
    // With a single 20ms interval over 50ms we'd expect ~2-3 calls, not ~5-6
    assert.ok(calls <= 4, `expected at most ~3 polls, got ${calls}`);
  });

  test('skips a poll if the previous fetch is still in flight', async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    global.fetch = async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 30));
      concurrentCalls--;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') };
    };
    const fetcher = new VisionFrameFetcher({ apiKey: 'key1', pollIntervalMs: 10, previewBaseUrl: 'http://x' });
    fetcher.start();
    await new Promise((r) => setTimeout(r, 60));
    fetcher.stop();
    assert.equal(maxConcurrent, 1, 'never more than one in-flight fetch at a time');
  });
});
