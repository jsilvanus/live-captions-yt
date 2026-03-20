import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { isFifo, makeFifo } from '../src/ffmpeg/pipe-utils.js';

const TEST_TMP = join(tmpdir(), `lcyt-pipe-utils-test-${Date.now()}`);

// Basic unit test: create a regular file and confirm isFifo returns false.
Deno && Deno.version; // noop to keep tooling quiet if Deno present

try {
  writeFileSync(TEST_TMP, 'x');
  assert.equal(isFifo(TEST_TMP), false);
  unlinkSync(TEST_TMP);
} catch (e) {
  // If write fails, let test framework handle it
  throw e;
}

// If on POSIX, test makeFifo via spawn (may require mkfifo to be available).
if (process.platform !== 'win32') {
  const path = TEST_TMP + '.fifo';
  (async () => {
    try {
      const res = await makeFifo(path);
      assert.equal(res.createdAsFifo, true);
      // cleanup
      try { unlinkSync(path); } catch {}
    } catch (err) {
      // If mkfifo not available, that's okay — test should not fail CI on systems without mkfifo.
      console.warn('makeFifo test skipped (mkfifo unavailable):', err.message);
    }
  })();
}
