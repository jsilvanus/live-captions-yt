import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isFifo, makeFifo } from '../src/ffmpeg/pipe-utils.js';

test('makeFifo / isFifo behavior (platform aware)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fifo-test-'));
  const p = join(tmp, 'thefifo');

  const res = await makeFifo(p);
  // On Windows we create a regular file fallback; on POSIX we create a FIFO
  if (process.platform === 'win32') {
    assert.equal(res.createdAsFifo, false);
    // file content may be empty
    const content = readFileSync(p, 'utf8');
    assert.equal(typeof content, 'string');
    assert.equal(isFifo(p), false);
  } else {
    assert.equal(res.createdAsFifo, true);
    assert.equal(isFifo(p), true);
  }

  try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
});
