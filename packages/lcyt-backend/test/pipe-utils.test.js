import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { isFifo, makeFifo } from '../src/ffmpeg/pipe-utils.js';

const TEST_TMP = join(tmpdir(), `lcyt-pipe-utils-test-${Date.now()}`);

// Basic unit test: create a regular file and confirm isFifo returns false.
writeFileSync(TEST_TMP, 'x');
try {
  assert.equal(isFifo(TEST_TMP), false);
} finally {
  try { unlinkSync(TEST_TMP); } catch {}
}

// If on POSIX, test makeFifo via spawn (may require mkfifo to be available).
if (process.platform !== 'win32') {
  const path = TEST_TMP + '.fifo';
  try {
    const res = await makeFifo(path);
    assert.equal(res.createdAsFifo, true);
  } catch (err) {
    console.warn('makeFifo test skipped (mkfifo unavailable):', err.message);
  } finally {
    try { unlinkSync(path); } catch {}
  }
}
