import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFfmpegRunner, LocalFfmpegRunner } from '../src/ffmpeg/index.js';

test("runner 'docker' was removed and falls back to spawn", () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const r = createFfmpegRunner({ runner: 'docker', args: ['-version'] });
    assert.ok(r instanceof LocalFfmpegRunner);
    createFfmpegRunner({ runner: 'docker', args: ['-version'] });
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 1, 'warns once');
  assert.match(warnings[0], /removed/);
});

test('unknown runner still throws', () => {
  assert.throws(() => createFfmpegRunner({ runner: 'nope' }), /Unknown ffmpeg runner/);
});
