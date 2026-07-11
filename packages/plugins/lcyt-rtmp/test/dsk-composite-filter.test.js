/**
 * Tests for buildDskCompositeFilter — the DSK RTMP composite ffmpeg
 * -filter_complex value, with optional chroma-keying
 * (plan_dsk_viewport_settings Phase 5).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDskCompositeFilter } from '../src/rtmp-manager.js';

describe('buildDskCompositeFilter', () => {
  test('no chromaKey → plain opaque overlay (unchanged behavior)', () => {
    assert.equal(buildDskCompositeFilter(null), '[0:v][1:v]overlay=0:0:shortest=1[ovout]');
    assert.equal(buildDskCompositeFilter({ enabled: false, color: '#00B140' }), '[0:v][1:v]overlay=0:0:shortest=1[ovout]');
  });

  test('enabled chromaKey → colorkey then overlay, hex converted to 0x', () => {
    const out = buildDskCompositeFilter({ enabled: true, color: '#00B140', similarity: 0.3, blend: 0.1 });
    assert.equal(out, '[1:v]colorkey=0x00B140:0.3:0.1[keyed];[0:v][keyed]overlay=0:0:shortest=1[ovout]');
  });

  test('defaults similarity/blend and defaults color when missing', () => {
    const out = buildDskCompositeFilter({ enabled: true });
    assert.equal(out, '[1:v]colorkey=0x00B140:0.3:0.1[keyed];[0:v][keyed]overlay=0:0:shortest=1[ovout]');
  });

  test('clamps similarity/blend to 0..1', () => {
    const out = buildDskCompositeFilter({ enabled: true, color: '#112233', similarity: 5, blend: -2 });
    assert.equal(out, '[1:v]colorkey=0x112233:1:0[keyed];[0:v][keyed]overlay=0:0:shortest=1[ovout]');
  });

  test('sanitizes a non-hex color to alnum (no filter-graph injection)', () => {
    const out = buildDskCompositeFilter({ enabled: true, color: 'green; drawtext=x' });
    // Non-#RRGGBB colors are stripped to [0-9a-zA-Z] so no ':', ';', '=', or
    // space from user input can inject extra filter-graph tokens.
    assert.equal(out, '[1:v]colorkey=greendrawtextx:0.3:0.1[keyed];[0:v][keyed]overlay=0:0:shortest=1[ovout]');
    assert.ok(!out.includes(' '));
  });
});
