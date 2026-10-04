import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFleet } from 'fffleet';
import { FleetFfmpegRunner } from '../src/ffmpeg/fleet-runner.js';
import { createFfmpegRunner } from '../src/ffmpeg/index.js';

const fleet = createFleet({}); // local mode

test('a job that ends by itself reports close with its exit code', async () => {
  const r = new FleetFfmpegRunner({ fleet, args: ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc', '-t', '0.2', '-f', 'null', '-'], purpose: 'test' });
  await r.start();
  const info = await new Promise((resolve) => r.once('close', resolve));
  assert.equal(info.code, 0);
  assert.equal(r.isRunning(), false);
});

test('a failing command closes with a non-zero code', async () => {
  const r = new FleetFfmpegRunner({ fleet, args: ['-v', 'error', '-i', '/no/such/file', '-f', 'null', '-'], purpose: 'test' });
  await r.start();
  const info = await new Promise((resolve) => r.once('close', resolve));
  assert.notEqual(info.code, 0);
});

test('stop() cancels a running stream job', async () => {
  const r = new FleetFfmpegRunner({ fleet, args: ['-v', 'error', '-re', '-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], purpose: 'test' });
  await r.start();
  assert.equal(r.isRunning(), true);
  const res = await r.stop(5000);
  assert.equal(res.timedOut, false);
  assert.equal(r.isRunning(), false);
});

test('stdin writes reach ffmpeg', async () => {
  // ffmpeg reads SRT from stdin and finishes when the cue stream ends
  const r = new FleetFfmpegRunner({ fleet, stdin: 'pipe', args: ['-v', 'error', '-f', 'subrip', '-i', 'pipe:0', '-f', 'null', '-'], purpose: 'test' });
  await r.start();
  const closed = new Promise((resolve) => r.once('close', resolve));
  await r.writeCaption({ text: 'Hei', startMs: 0, durationMs: 1000 });
  r.stdin.write('2\n00:00:01,000 --> 00:00:02,000\nMaailma\n\n');
  await r.stop(5000);
  await closed;
});

test("the factory builds a fleet runner for FFMPEG_RUNNER=fleet", () => {
  const r = createFfmpegRunner({ runner: 'fleet', args: [] });
  assert.ok(r instanceof FleetFfmpegRunner);
});
