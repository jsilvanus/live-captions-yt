import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// PreviewManager lives in the rtmp plugin; import dynamically to avoid hoisting
import { PreviewManager } from '../../plugins/lcyt-rtmp/src/preview-manager.js';

test('PreviewManager starts/stops using a fake ffmpeg in PATH', async () => {
  const tmp = fs.mkdtempSync(join(tmpdir(), 'preview-test-'));
  const fakeBinDir = fs.mkdtempSync(join(tmpdir(), 'fakebin-'));

  // Create a fake `ffmpeg` shell script that sleeps to simulate a running process.
  const ffPath = join(fakeBinDir, 'ffmpeg');
  fs.writeFileSync(ffPath, '#!/bin/sh\n# fake ffmpeg for tests\nsleep 2\n', 'utf8');
  fs.chmodSync(ffPath, 0o755);

  // Prepend fake bin to PATH so child_process.spawn('ffmpeg') finds our script.
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}${process.platform === 'win32' ? ';' : ':'}${oldPath}`;

  const manager = new PreviewManager({ previewRoot: tmp, localRtmp: 'rtmp://127.0.0.1:1935', rtmpApp: 'live', intervalS: 1 });
  const key = 'test-key';

  await manager.start(key);
  assert(manager.isRunning(key), 'PreviewManager should report running after start');

  // Directory should exist
  const p = manager.previewPath(key);
  assert(fs.existsSync(join(tmp, key)), 'preview directory should exist');

  await manager.stop(key);
  assert.equal(manager.isRunning(key), false);

  // cleanup
  process.env.PATH = oldPath;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(fakeBinDir, { recursive: true, force: true }); } catch {}
});
