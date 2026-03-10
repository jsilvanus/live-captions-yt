/**
 * Unit tests for the viewer utility functions in src/lib/viewerUtils.js.
 *
 * These tests exercise the pure, side-effect-free logic that drives the
 * /view/<key> and /embed/viewer pages without requiring a browser or React.
 *
 * Run with:
 *   node --test test/viewer.test.js
 * or:
 *   npm test -w packages/lcyt-web
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveViewerText, collectLangTexts } from '../src/lib/viewerUtils.js';

// ---------------------------------------------------------------------------
// resolveViewerText
// ---------------------------------------------------------------------------

describe('resolveViewerText', () => {
  const data = {
    text:        'Hello original',
    composedText: 'Hello original<br>Hei alkuperäinen',
    translations: {
      'fi-FI': 'Hei alkuperäinen',
      'sv-SE': 'Hej original',
    },
  };

  it('returns composedText when lang is empty string, undefined, or null', () => {
    assert.equal(resolveViewerText(data, ''), data.composedText);
    assert.equal(resolveViewerText(data, undefined), data.composedText);
    assert.equal(resolveViewerText(data, null), data.composedText);
  });

  it('returns original text when lang is "original"', () => {
    assert.equal(resolveViewerText(data, 'original'), data.text);
  });

  it('returns composedText when lang is "all" (caller handles column layout separately)', () => {
    assert.equal(resolveViewerText(data, 'all'), data.composedText);
  });

  it('returns requested translation when it exists', () => {
    assert.equal(resolveViewerText(data, 'fi-FI'), 'Hei alkuperäinen');
    assert.equal(resolveViewerText(data, 'sv-SE'), 'Hej original');
  });

  it('falls back to composedText when translation does not exist', () => {
    assert.equal(resolveViewerText(data, 'de-DE'), data.composedText);
  });

  it('falls back to text when translation and composedText are absent', () => {
    const minimal = { text: 'Raw text only' };
    assert.equal(resolveViewerText(minimal, 'fi-FI'), 'Raw text only');
  });

  it('falls back to empty string when all text fields are absent', () => {
    assert.equal(resolveViewerText({}, 'fi-FI'), '');
    assert.equal(resolveViewerText({}, ''), '');
    assert.equal(resolveViewerText({}, 'original'), '');
  });

  it('handles data with no translations object but lang specified', () => {
    const noTrans = { text: 'No trans', composedText: 'No trans' };
    assert.equal(resolveViewerText(noTrans, 'fi-FI'), 'No trans');
  });

  it('returns composedText over text when lang is empty and composedText differs', () => {
    const d = { text: 'orig', composedText: 'orig + trans' };
    assert.equal(resolveViewerText(d, ''), 'orig + trans');
  });
});

// ---------------------------------------------------------------------------
// collectLangTexts
// ---------------------------------------------------------------------------

describe('collectLangTexts', () => {
  it('returns original text under "original" key', () => {
    const data = { text: 'Hello', translations: {} };
    const result = collectLangTexts(data);
    assert.equal(result.original, 'Hello');
  });

  it('includes all translations in the returned map', () => {
    const data = {
      text: 'Hello',
      translations: { 'fi-FI': 'Hei', 'sv-SE': 'Hej' },
    };
    const result = collectLangTexts(data);
    assert.equal(result.original, 'Hello');
    assert.equal(result['fi-FI'], 'Hei');
    assert.equal(result['sv-SE'], 'Hej');
  });

  it('omits empty/falsy translation values', () => {
    const data = {
      text: 'Hello',
      translations: { 'fi-FI': '', 'sv-SE': 'Hej' },
    };
    const result = collectLangTexts(data);
    assert.ok(!('fi-FI' in result), 'should not include empty translation');
    assert.equal(result['sv-SE'], 'Hej');
  });

  it('returns just original when translations is missing', () => {
    const result = collectLangTexts({ text: 'Just original' });
    assert.deepEqual(Object.keys(result), ['original']);
    assert.equal(result.original, 'Just original');
  });

  it('returns empty original when text is missing', () => {
    const result = collectLangTexts({});
    assert.equal(result.original, '');
  });

  it('does not include composedText in the language map', () => {
    const data = { text: 'orig', composedText: 'orig<br>trans', translations: { 'fi-FI': 'trans' } };
    const result = collectLangTexts(data);
    assert.ok(!('composedText' in result));
  });
});
