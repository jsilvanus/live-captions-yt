import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    pipeUtils.openFifoNonBlocking = origOpen;
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
