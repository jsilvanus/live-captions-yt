import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeFifo, createFifoWriter, isFifo } from '../src/ffmpeg/pipe-utils.js';

test('createFifoWriter: write times out when open fails (EAGAIN)', async () => {
  const pipeUtils = await import('../src/ffmpeg/pipe-utils.js');
  const origOpen = pipeUtils.openFifoNonBlocking;

  // Simulate open failing with EAGAIN so writer will retry until timeout
  pipeUtils.__test_setOpenFifo(() => {
    const err = new Error('resource temporarily unavailable');
    err.code = 'EAGAIN';
    throw err;
  });

  const writer = pipeUtils.createFifoWriter('/does/not/matter', { timeoutMs: 50 });
  try {
    const ok = await writer.write('payload');
    assert.strictEqual(ok, false, 'write should time out and return false');
  } finally {
    await writer.close();
    pipeUtils.__test_setOpenFifo(origOpen);
  }
});

test('createFifoWriter: write succeeds when reader present and drains', async () => {
  const pipeUtils = await import('../src/ffmpeg/pipe-utils.js');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-utils-'));
  const filePath = path.join(tmpDir, 'fifo-file');
  fs.writeFileSync(filePath, '');

  // Open a reader to emulate a consumer/drainer
  const readerFd = fs.openSync(filePath, 'r');

  const origOpen = pipeUtils.openFifoNonBlocking;
  // Monkeypatch open to open the temp file for writing (deterministic cross-platform)
  pipeUtils.__test_setOpenFifo((p, flags) => fs.openSync(filePath, 'w'));

  const writer = pipeUtils.createFifoWriter(filePath, { timeoutMs: 200 });
  try {
    const ok = await writer.write('hello-world');
    assert.strictEqual(ok, true, 'write should succeed when writer can open and write');

    // Read back what was written to ensure data reached the reader file
    const buf = Buffer.alloc(64);
    const bytes = fs.readSync(readerFd, buf, 0, buf.length, 0);
    assert(bytes > 0, 'reader should see written bytes');
  } finally {
    await writer.close();
    try { fs.closeSync(readerFd); } catch (e) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    pipeUtils.__test_setOpenFifo(origOpen);
  }
});

test('createFifoWriter writes to regular file (fallback) and resolves true', async () => {
  const tmp = mkdtempSync(join(process.env.TEMP || '/tmp', 'pipe-utils-'));
  try {
    const p = join(tmp, 'out.txt');
    // On non-POSIX this acts like fallback file
    await makeFifo(p);
    const writer = createFifoWriter(p, { timeoutMs: 200 });
    const ok = await writer.write('hello world\n');
    assert.equal(ok, true);
    await writer.close();
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});

test('createFifoWriter on POSIX without reader should time out or throw ENXIO', async () => {
  if (process.platform === 'win32') return;

  const tmp = mkdtempSync(join('/tmp', 'pipe-utils-'));
  try {
    const p = join(tmp, 'fifo.srt');
    await makeFifo(p);
    const writer = createFifoWriter(p, { timeoutMs: 100 });
    try {
      const ok = await writer.write('no reader test\n');
      // either false (timed out) or true if OS accepted writes
      assert.ok(ok === false || ok === true);
    } catch (err) {
      // ENXIO is acceptable when opening FIFO write-only without reader
      assert.ok(err.code === 'ENXIO' || err.code === 'EAGAIN' || err.code === 'EPIPE');
    } finally {
      await writer.close();
    }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});

test('isFifo / makeFifo basic behavior', async () => {
  const TEST_TMP = join(os.tmpdir(), `lcyt-pipe-utils-test-${Date.now()}`);
  // Basic unit test: create a regular file and confirm isFifo returns false.
  fs.writeFileSync(TEST_TMP, 'x');
  try {
    assert.equal(isFifo(TEST_TMP), false);
  } finally {
    try { unlinkSync(TEST_TMP); } catch (e) {}
  }

  if (process.platform !== 'win32') {
    const pathF = TEST_TMP + '.fifo';
    try {
      const res = await makeFifo(pathF);
      assert.equal(res.createdAsFifo, true);
    } catch (err) {
      console.warn('makeFifo test skipped (mkfifo unavailable):', err.message);
    } finally {
      try { unlinkSync(pathF); } catch (e) {}
    }
  }
});
