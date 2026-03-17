/**
 * Unit tests for caption-files.js pure-function exports.
 *
 * writeToBackendFile and ensureKeyDir involve filesystem I/O and are
 * tested separately (only pure-function exports here).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeCaptionText, formatVttTime, buildVttCue } from '../src/caption-files.js';

// ---------------------------------------------------------------------------
// composeCaptionText()
// ---------------------------------------------------------------------------

describe('composeCaptionText', () => {
  it('returns original text when captionLang is null', () => {
    assert.equal(composeCaptionText('Hello', null, { 'fi-FI': 'Hei' }, false), 'Hello');
  });

  it('returns original text when translations is null', () => {
    assert.equal(composeCaptionText('Hello', 'fi-FI', null, false), 'Hello');
  });

  it('returns original text when translations is empty', () => {
    assert.equal(composeCaptionText('Hello', 'fi-FI', {}, false), 'Hello');
  });

  it('returns original text when translation is missing for the lang', () => {
    assert.equal(composeCaptionText('Hello', 'fi-FI', { 'de-DE': 'Hallo' }, false), 'Hello');
  });

  it('returns only the translation when showOriginal=false', () => {
    assert.equal(composeCaptionText('Hello', 'fi-FI', { 'fi-FI': 'Hei' }, false), 'Hei');
  });

  it('returns "original<br>translation" when showOriginal=true', () => {
    assert.equal(
      composeCaptionText('Hello', 'fi-FI', { 'fi-FI': 'Hei' }, true),
      'Hello<br>Hei'
    );
  });

  it('returns original text when translation equals the original (same language no-op)', () => {
    assert.equal(composeCaptionText('Moi', 'fi-FI', { 'fi-FI': 'Moi' }, false), 'Moi');
  });

  it('returns original text when showOriginal is undefined', () => {
    // showOriginal falsy → just the translation
    assert.equal(composeCaptionText('Hello', 'fi-FI', { 'fi-FI': 'Hei' }, undefined), 'Hei');
  });
});

// ---------------------------------------------------------------------------
// formatVttTime()
// ---------------------------------------------------------------------------

describe('formatVttTime', () => {
  it('formats 0ms as 00:00:00.000', () => {
    assert.equal(formatVttTime(0), '00:00:00.000');
  });

  it('formats 1ms as 00:00:00.001', () => {
    assert.equal(formatVttTime(1), '00:00:00.001');
  });

  it('formats 1000ms (1s) as 00:00:01.000', () => {
    assert.equal(formatVttTime(1000), '00:00:01.000');
  });

  it('formats 60000ms (1m) as 00:01:00.000', () => {
    assert.equal(formatVttTime(60_000), '00:01:00.000');
  });

  it('formats 3600000ms (1h) as 01:00:00.000', () => {
    assert.equal(formatVttTime(3_600_000), '01:00:00.000');
  });

  it('formats 3661001ms (1h 1m 1s 1ms)', () => {
    assert.equal(formatVttTime(3_661_001), '01:01:01.001');
  });

  it('formats 90500ms (1m 30s 500ms)', () => {
    assert.equal(formatVttTime(90_500), '00:01:30.500');
  });

  it('pads milliseconds to 3 digits', () => {
    assert.equal(formatVttTime(50), '00:00:00.050');
  });
});

// ---------------------------------------------------------------------------
// buildVttCue()
// ---------------------------------------------------------------------------

describe('buildVttCue', () => {
  it('formats a single cue with sequence, timestamps, and text', () => {
    const cue = buildVttCue(1, 0, 3000, 'Hello world');
    assert.equal(cue, '1\n00:00:00.000 --> 00:00:03.000\nHello world\n\n');
  });

  it('includes the correct sequence number', () => {
    const cue = buildVttCue(42, 0, 1000, 'Test');
    assert.ok(cue.startsWith('42\n'));
  });

  it('uses startMs and endMs for the timestamp line', () => {
    const cue = buildVttCue(1, 5000, 8000, 'Line');
    assert.ok(cue.includes('00:00:05.000 --> 00:00:08.000'));
  });

  it('ends with a blank line (double newline)', () => {
    const cue = buildVttCue(1, 0, 3000, 'Text');
    assert.ok(cue.endsWith('\n\n'));
  });

  it('handles multi-word text', () => {
    const cue = buildVttCue(1, 0, 3000, 'This is a longer caption with several words');
    assert.ok(cue.includes('This is a longer caption with several words'));
  });
});
