/**
 * End-to-end proof of stdin-command crop repositioning on a stock ffmpeg
 * (no zmq, no control port): `Ccrop@vcrop -1 x N\n` written to ffmpeg's stdin
 * moves the crop window. Decodes real output frames (raw RGB over a pipe) from
 * a synthetic source whose left half is red and right half is green, and
 * measures stdin-write → first-changed-frame delay.
 *
 * Skips when ffmpeg is missing. Set CROP_STDIN_VERBOSE=1 to print the numbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { LocalFfmpegRunner } from 'lcyt-compute/ffmpeg';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const skip = hasFfmpeg ? false : 'ffmpeg not installed';
const VERBOSE = !!process.env.CROP_STDIN_VERBOSE;

const FPS = 30;
const IN_W = 640, IN_H = 360;      // left 320 px red, right 320 px green
const CROP_W = 160, CROP_H = 360;  // window; x=0 is red, x=480 is green
const OUT_W = 32, OUT_H = 72;      // tiny rawvideo frames
const FRAME_BYTES = OUT_W * OUT_H * 3;

/** Source: red|green via two lavfi inputs hstacked in the filtergraph. */
function buildArgs() {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-re', '-f', 'lavfi', '-i', `color=c=red:s=${IN_W / 2}x${IN_H}:r=${FPS}`,
    '-re', '-f', 'lavfi', '-i', `color=c=0x00ff00:s=${IN_W / 2}x${IN_H}:r=${FPS}`,
    '-filter_complex',
    `[0:v][1:v]hstack,crop@vcrop=${CROP_W}:${CROP_H}:0:0,scale=${OUT_W}:${OUT_H},format=rgb24[v]`,
    '-map', '[v]', '-f', 'rawvideo', '-flush_packets', '1', 'pipe:1',
  ];
}

/** Colour of a frame: 'red' | 'green' | 'mixed' (centre-row sample at both thirds). */
function classify(frame) {
  const px = x => { const o = (Math.floor(OUT_H / 2) * OUT_W + x) * 3; return [frame[o], frame[o + 1], frame[o + 2]]; };
  const isRed = p => p[0] > 200 && p[1] < 60;
  const isGreen = p => p[1] > 200 && p[0] < 60;
  const a = px(2), b = px(OUT_W - 3);
  if (isRed(a) && isRed(b)) return 'red';
  if (isGreen(a) && isGreen(b)) return 'green';
  return 'mixed';
}

async function startSession() {
  const runner = new LocalFfmpegRunner({ cmd: 'ffmpeg', args: buildArgs(), stdin: 'pipe' });
  await runner.start();
  const stdin = runner.proc.stdin;
  assert.ok(stdin, 'local runner started with stdin: pipe must have a stdin');
  stdin.on('error', () => {});
  const s = { runner, frames: [], buf: Buffer.alloc(0), stderr: '', closed: false, onFrame: null };
  runner.stderr.on('data', d => { s.stderr += d; });
  runner.on('close', () => { s.closed = true; });
  runner.stdout.on('data', chunk => {
    s.buf = Buffer.concat([s.buf, chunk]);
    while (s.buf.length >= FRAME_BYTES) {
      const frame = s.buf.subarray(0, FRAME_BYTES);
      s.buf = s.buf.subarray(FRAME_BYTES);
      const f = { t: performance.now(), color: classify(frame) };
      s.frames.push(f);
      s.onFrame?.(f);
    }
  });
  s.move = x => { const t = performance.now(); stdin.write(`Ccrop@vcrop -1 x ${x}\nCcrop@vcrop -1 y 0\n`); return t; };
  s.waitFrames = n => new Promise(res => {
    const target = s.frames.length + n;
    const iv = setInterval(() => { if (s.frames.length >= target || s.closed) { clearInterval(iv); res(); } }, 5);
  });
  s.stop = async () => { await runner.stop(2000); };
  return s;
}

/** Wait for a frame of `color`, return { ms, frames } relative to tWrite. */
function waitForColor(s, color, tWrite, timeoutMs = 3000) {
  const idx0 = s.frames.length;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${color} frame within ${timeoutMs} ms`)), timeoutMs);
    s.onFrame = f => {
      if (f.color === color) {
        clearTimeout(timer); s.onFrame = null;
        resolve({ ms: f.t - tWrite, frames: s.frames.length - idx0 });
      }
    };
  });
}

test('stdin command moves the crop window (decoded frame colour flips) and reports latency', { skip }, async () => {
  const delays = [];
  for (let run = 0; run < 5; run++) {
    const s = await startSession();
    try {
      await s.waitFrames(15);
      assert.equal(s.frames.at(-1).color, 'red', 'starts on the red half');
      const t = s.move(480);
      const r = await waitForColor(s, 'green', t);
      delays.push(r);
      // and it stays moved
      await s.waitFrames(10);
      assert.equal(s.frames.at(-1).color, 'green');
      // move back
      const t2 = s.move(0);
      await waitForColor(s, 'red', t2);
    } finally { await s.stop(); }
  }
  const ms = delays.map(d => d.ms);
  if (VERBOSE) console.log('crop stdin latency ms:', ms.map(v => v.toFixed(1)).join(', '), '| frames:', delays.map(d => d.frames).join(','));
  // One frame is 33 ms at 30 fps; a command must land within a few frames.
  assert.ok(Math.max(...ms) < 500, `latency too high: ${ms}`);
});

test('rapid repeated moves (10/s for 4 s) do not stall or crash ffmpeg', { skip }, async () => {
  const s = await startSession();
  try {
    await s.waitFrames(10);
    const startIdx = s.frames.length, t0 = performance.now();
    let n = 0;
    await new Promise(res => {
      const iv = setInterval(() => {
        s.move(n % 2 ? 0 : 480); n++;
        if (n >= 40) { clearInterval(iv); res(); }
      }, 100);
    });
    const elapsed = performance.now() - t0;
    const frames = s.frames.slice(startIdx);
    let maxGap = 0;
    for (let i = 1; i < frames.length; i++) maxGap = Math.max(maxGap, frames[i].t - frames[i - 1].t);
    const colors = new Set(frames.map(f => f.color));
    if (VERBOSE) console.log(`rapid: ${frames.length} frames in ${elapsed.toFixed(0)} ms (expect ~${Math.round(elapsed * FPS / 1000)}), max inter-frame gap ${maxGap.toFixed(0)} ms`);
    assert.equal(s.closed, false, 'ffmpeg still running');
    assert.ok(colors.has('red') && colors.has('green'), 'window really moved back and forth');
    assert.ok(frames.length >= elapsed * FPS / 1000 * 0.8, 'frame rate held');
    assert.ok(maxGap < 400, `stall detected: ${maxGap} ms gap`);
  } finally { await s.stop(); }
});

test('idle stdin (no writes) never blocks ffmpeg; a late command still lands', { skip }, async () => {
  const s = await startSession();
  try {
    await s.waitFrames(5);
    const startIdx = s.frames.length, t0 = performance.now();
    await new Promise(r => setTimeout(r, 2500)); // stdin open, silent
    const frames = s.frames.slice(startIdx);
    const elapsed = performance.now() - t0;
    let maxGap = 0;
    for (let i = 1; i < frames.length; i++) maxGap = Math.max(maxGap, frames[i].t - frames[i - 1].t);
    if (VERBOSE) console.log(`idle: ${frames.length} frames in ${elapsed.toFixed(0)} ms, max gap ${maxGap.toFixed(0)} ms`);
    assert.ok(frames.length >= elapsed * FPS / 1000 * 0.8);
    assert.ok(maxGap < 400);
    const t = s.move(480);
    await waitForColor(s, 'green', t);
  } finally { await s.stop(); }
});
