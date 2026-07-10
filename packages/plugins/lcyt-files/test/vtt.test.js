/**
 * Tests for shiftVttContent — cue-time shifting for VOD alignment.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { shiftVttContent } from '../src/vtt.js';

const DOC = `WEBVTT

1
00:00:14.000 --> 00:00:17.000
Hello world

2
00:01:14.500 --> 00:01:17.500
Second line
`;

describe('shiftVttContent', () => {
  test('shifts cue times forward', () => {
    const out = shiftVttContent(DOC, 2500);
    assert.ok(out.includes('00:00:16.500 --> 00:00:19.500'));
    assert.ok(out.includes('00:01:17.000 --> 00:01:20.000'));
  });

  test('shifts cue times backward', () => {
    const out = shiftVttContent(DOC, -14_000);
    assert.ok(out.includes('00:00:00.000 --> 00:00:03.000'));
    assert.ok(out.includes('00:01:00.500 --> 00:01:03.500'));
  });

  test('clamps at zero instead of going negative', () => {
    const out = shiftVttContent(DOC, -15_000);
    assert.ok(out.includes('00:00:00.000 --> 00:00:02.000'));
  });

  test('leaves header, identifiers, and cue text untouched', () => {
    const out = shiftVttContent(DOC, 1000);
    assert.ok(out.startsWith('WEBVTT\n'));
    assert.ok(out.includes('\n1\n'));
    assert.ok(out.includes('Hello world'));
    assert.ok(out.includes('Second line'));
  });

  test('does not rewrite time-like text outside timing lines', () => {
    const doc = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nMeet at 00:00:09.000 sharp\n';
    const out = shiftVttContent(doc, 1000);
    assert.ok(out.includes('00:00:02.000 --> 00:00:05.000'));
    assert.ok(out.includes('Meet at 00:00:09.000 sharp'));
  });

  test('handles short MM:SS.mmm cue times', () => {
    const doc = 'WEBVTT\n\n00:14.000 --> 00:17.000\nShort form\n';
    const out = shiftVttContent(doc, 1000);
    assert.ok(out.includes('00:00:15.000 --> 00:00:18.000'));
  });

  test('handles multi-digit hours', () => {
    const doc = 'WEBVTT\n\n101:00:00.000 --> 101:00:03.000\nLong stream\n';
    const out = shiftVttContent(doc, -3_600_000);
    assert.ok(out.includes('100:00:00.000 --> 100:00:03.000'));
  });

  test('returns content unchanged for zero or invalid offset', () => {
    assert.equal(shiftVttContent(DOC, 0), DOC);
    assert.equal(shiftVttContent(DOC, NaN), DOC);
    assert.equal(shiftVttContent(DOC, undefined), DOC);
  });
});
