import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFfmpegFrameSource, createFallbackFrameSource } from '../src/perception/ffmpeg-frame-source.js';
import { createPerceptionRunner } from '../src/perception/runner.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const SIZE = 64;

async function clip(dir) {
  const path = join(dir, 'clip.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=3', '-pix_fmt', 'yuv420p', path]);
  assert.equal(r.status, 0, String(r.stderr));
  return path;
}

async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('stream source delivers fresh letterboxed RGB frames and keeps only the newest', { skip: !hasFfmpeg }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'perc-fs-'));
  const src = createFfmpegFrameSource({ url: await clip(dir), size: SIZE, fps: 10, inputArgs: ['-re', '-stream_loop', '-1'] });
  try {
    const first = await waitFor(() => src.getFrame());
    assert.equal(first.width, SIZE);
    assert.equal(first.height, SIZE);
    assert.equal(first.data.length, SIZE * SIZE * 3);
    // 320x180 into 64x64: picture 64x36, bars of 14 rows above and below.
    assert.deepEqual([first.letterbox.newW, first.letterbox.newH, first.letterbox.padY], [64, 36, 14]);
    // The bars are the grey pad colour, the picture is not.
    assert.equal(first.data[0], 114);
    assert.equal(first.data[1], 114);
    assert.ok(Date.now() - first.capturedAt < 3000);
    const later = await waitFor(async () => { const f = await src.getFrame(); return f && f.seq > first.seq ? f : null; });
    assert.ok(later.capturedAt >= first.capturedAt);
  } finally {
    src.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('stream source: an unreadable stream throws after the allowed failures, so a fallback can take over', { skip: !hasFfmpeg }, async () => {
  const src = createFfmpegFrameSource({ url: '/nonexistent/stream.mp4', size: SIZE, failuresBeforeError: 2, restartDelayMs: 20 });
  try {
    await assert.rejects(waitFor(async () => { await src.getFrame(); return false; }, 8000), /ffprobe could not read the stream|ENOENT|ffmpeg exited/);
  } finally {
    src.close();
  }
});

test('stream source needs a url and a size', () => {
  assert.throws(() => createFfmpegFrameSource({ size: 64 }), /needs a url/);
  assert.throws(() => createFfmpegFrameSource({ url: 'rtsp://x/y' }), /input size/);
});

test('fallback source switches to the secondary after repeated failures and closes the primary', async () => {
  let closed = false;
  const switched = [];
  const primary = { getFrame: async () => { throw new Error('stream down'); }, close: () => { closed = true; } };
  const secondary = { getFrame: async () => Buffer.from('jpeg') };
  const src = createFallbackFrameSource(primary, secondary, { afterFailures: 2, onSwitch: (e) => switched.push(e.message) });
  await assert.rejects(src.getFrame(), /stream down/);
  assert.deepEqual(await src.getFrame(), Buffer.from('jpeg'));
  assert.deepEqual(await src.getFrame(), Buffer.from('jpeg'));
  assert.equal(closed, true);
  assert.deepEqual(switched, ['stream down']);
});

test('runner stamps seq, capturedAt and latency and closes its frame source on stop', async () => {
  let closed = false;
  const capturedAt = Date.now() - 250;
  const frameSource = { getFrame: async () => ({ capturedAt }), close: () => { closed = true; } };
  const got = [];
  const runner = createPerceptionRunner('cam-1', frameSource, {
    emitIntervalMs: 200,
    backend: { detect: async () => ({ objects: [{ label: 'person', confidence: 0.9, bbox: { x: 0, y: 0, w: 1, h: 1 } }], framing: null }) },
    onDetection: (d) => got.push(d),
  });
  runner.start();
  await waitFor(() => got.length >= 2);
  runner.stop();
  assert.deepEqual(got.map((d) => d.seq).slice(0, 2), [1, 2]);
  assert.equal(got[0].capturedAt, capturedAt);
  assert.ok(got[0].latencyMs >= 250);
  assert.equal(got[0].visible, true);
  assert.equal(closed, true);
});
