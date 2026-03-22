import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { LocalFfmpegRunner } from '../src/ffmpeg/local-runner.js';

test('LocalFfmpegRunner start/stop lifecycle (uses node as fake ffmpeg)', async (t) => {
  // Use node as a harmless long-running process so we don't require ffmpeg.
  const runner = new LocalFfmpegRunner({ cmd: process.execPath, args: ['-e', 'setTimeout(()=>{}, 10000)'], name: 'test-ffmpeg' });

  // Start should be awaited and return a RunnerHandle (this) and expose stdout/stderr.
  const handle = await runner.start();
  assert(handle, 'start() should return a RunnerHandle');
  assert(runner.stdout === handle.stdout || runner.stdout === null);

  // isRunning should be truthy while process is alive
  assert.equal(runner.isRunning(), true);

  // stop() should resolve and clear running state
  await runner.stop(1000);
  // After stop completes, runner should not be running
  assert.equal(runner.isRunning(), false);
});
