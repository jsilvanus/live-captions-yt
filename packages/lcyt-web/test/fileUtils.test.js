/**
 * Tests for parseFileContent() from src/lib/fileUtils.js
 *
 * parseFileContent() is a pure function — no browser APIs required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileContent } from '../src/lib/fileUtils.js';

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('parseFileContent() — basic', () => {
  it('returns empty arrays for empty string', () => {
    const { lines, lineCodes, lineNumbers } = parseFileContent('');
    assert.deepEqual(lines, []);
    assert.deepEqual(lineCodes, []);
    assert.deepEqual(lineNumbers, []);
  });

  it('parses plain lines', () => {
    const raw = 'First line\nSecond line\nThird line';
    const { lines, lineNumbers } = parseFileContent(raw);
    assert.deepEqual(lines, ['First line', 'Second line', 'Third line']);
    assert.deepEqual(lineNumbers, [1, 2, 3]);
  });

  it('ignores blank lines', () => {
    const raw = 'Line 1\n\n\nLine 2';
    const { lines } = parseFileContent(raw);
    assert.deepEqual(lines, ['Line 1', 'Line 2']);
  });

  it('trims leading/trailing whitespace from each line', () => {
    const raw = '  hello  \n  world  ';
    const { lines } = parseFileContent(raw);
    assert.deepEqual(lines, ['hello', 'world']);
  });
});

// ---------------------------------------------------------------------------
// Metadata comments
// ---------------------------------------------------------------------------

describe('parseFileContent() — metadata comments', () => {
  it('does not include metadata comment lines in output', () => {
    const raw = '<!-- lang: fi-FI -->\nCaption line';
    const { lines } = parseFileContent(raw);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'Caption line');
  });

  it('attaches metadata code to subsequent lines', () => {
    const raw = '<!-- lang: fi-FI -->\nCaption line';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].lang, 'fi-FI');
  });

  it('metadata persists across multiple lines', () => {
    const raw = '<!-- lang: fi-FI -->\nLine 1\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].lang, 'fi-FI');
    assert.equal(lineCodes[1].lang, 'fi-FI');
  });

  it('removes a code when value is empty', () => {
    const raw = '<!-- lang: fi-FI -->\nLine 1\n<!-- lang: -->\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].lang, 'fi-FI');
    assert.equal(lineCodes[1].lang, undefined);
  });

  it('overrides a code with a new value', () => {
    const raw = '<!-- lang: fi-FI -->\nLine 1\n<!-- lang: en-US -->\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].lang, 'fi-FI');
    assert.equal(lineCodes[1].lang, 'en-US');
  });

  it('accepts custom metadata keys', () => {
    const raw = '<!-- speaker: Alice -->\nLine 1';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].speaker, 'Alice');
  });

  it('coerces lyrics: true to boolean', () => {
    const raw = '<!-- lyrics: true -->\nLine 1';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].lyrics, true);
  });

  it('coerces no-translate: true to boolean', () => {
    const raw = '<!-- no-translate: true -->\nLine 1';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0]['no-translate'], true);
  });

  it('stores non-boolean codes as strings', () => {
    const raw = '<!-- section: chorus -->\nLine 1';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(typeof lineCodes[0].section, 'string');
    assert.equal(lineCodes[0].section, 'chorus');
  });
});

// ---------------------------------------------------------------------------
// Stanza blocks
// ---------------------------------------------------------------------------

describe('parseFileContent() — stanza blocks', () => {
  it('does not produce a caption line for the stanza block itself', () => {
    const raw = '<!-- stanza\nFirst song line\nSecond song line\n-->\nCaption';
    const { lines } = parseFileContent(raw);
    // Only 'Caption' should be in lines (not the stanza block lines)
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'Caption');
  });

  it('sets stanza code on the following caption line', () => {
    const raw = '<!-- stanza\nFirst song line\nSecond song line\n-->\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.ok(lineCodes[0].stanza);
    assert.ok(lineCodes[0].stanza.includes('First song line'));
    assert.ok(lineCodes[0].stanza.includes('Second song line'));
  });

  it('clears stanza code on empty stanza block', () => {
    const raw = '<!-- stanza\nFirst\n-->\nLine 1\n<!-- stanza\n-->\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.ok(lineCodes[0].stanza);
    assert.equal(lineCodes[1].stanza, undefined);
  });
});

// ---------------------------------------------------------------------------
// Empty-send markers
// ---------------------------------------------------------------------------

describe('parseFileContent() — empty-send markers', () => {
  it('creates an entry with empty string and emptySend=true for bare _', () => {
    const raw = '_\nCaption';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines[0], '');
    assert.equal(lineCodes[0].emptySend, true);
    assert.equal(lines[1], 'Caption');
  });

  it('captures optional label after _ space', () => {
    const raw = '_ intro\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].emptySend, true);
    assert.equal(lineCodes[0].emptySendLabel, 'intro');
  });

  it('empty-send inherits current metadata codes', () => {
    const raw = '<!-- lang: fi-FI -->\n_\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].lang, 'fi-FI');
    assert.equal(lineCodes[0].emptySend, true);
  });
});

// ---------------------------------------------------------------------------
// lineNumbers
// ---------------------------------------------------------------------------

describe('parseFileContent() — lineNumbers', () => {
  it('assigns sequential 1-based line numbers to text lines only', () => {
    const raw = '<!-- lang: fi-FI -->\nLine 1\nLine 2\n<!-- section: x -->\nLine 3';
    const { lineNumbers } = parseFileContent(raw);
    assert.deepEqual(lineNumbers, [1, 2, 3]);
  });

  it('counts empty-send markers in line numbers', () => {
    const raw = '_\nLine 1\nLine 2';
    const { lineNumbers } = parseFileContent(raw);
    assert.deepEqual(lineNumbers, [1, 2, 3]);
  });

  it('counts audio action lines in line numbers', () => {
    const raw = '<!-- audio: start -->\nLine 1\n<!-- audio: stop -->';
    const { lineNumbers } = parseFileContent(raw);
    assert.deepEqual(lineNumbers, [1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Audio action metacode (<!-- audio: start/stop -->)
// ---------------------------------------------------------------------------

describe('parseFileContent() — audio action metacode', () => {
  it('parses <!-- audio: start --> as an action line with audioCapture=start', () => {
    const { lines, lineCodes } = parseFileContent('<!-- audio: start -->');
    assert.deepEqual(lines, ['']);
    assert.equal(lineCodes[0].audioCapture, 'start');
  });

  it('parses <!-- audio: stop --> as an action line with audioCapture=stop', () => {
    const { lines, lineCodes } = parseFileContent('<!-- audio: stop -->');
    assert.deepEqual(lines, ['']);
    assert.equal(lineCodes[0].audioCapture, 'stop');
  });

  it('audio lines are interleaved with caption lines', () => {
    const raw = '<!-- audio: start -->\nHello\n<!-- audio: stop -->';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.deepEqual(lines, ['', 'Hello', '']);
    assert.equal(lineCodes[0].audioCapture, 'start');
    assert.equal(lineCodes[1].audioCapture, undefined);
    assert.equal(lineCodes[2].audioCapture, 'stop');
  });

  it('audio action does NOT persist into currentCodes for subsequent lines', () => {
    const raw = '<!-- audio: start -->\nLine 1\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[1].audioCapture, undefined);
    assert.equal(lineCodes[2].audioCapture, undefined);
  });

  it('audio action inherits currentCodes but does not add to them', () => {
    const raw = '<!-- lang: fi-FI -->\n<!-- audio: start -->\nLine 1';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].audioCapture, 'start');
    assert.equal(lineCodes[0].lang, 'fi-FI');   // inherits
    assert.equal(lineCodes[1].audioCapture, undefined);
    assert.equal(lineCodes[1].lang, 'fi-FI');   // lang persists normally
  });

  it('ignores unknown audio values (neither start nor stop)', () => {
    // "pause" is not a valid audio action — treated as regular metadata
    const raw = '<!-- audio: pause -->\nLine 1';
    const { lines } = parseFileContent(raw);
    assert.deepEqual(lines, ['Line 1']); // not added as an action line
  });
});

// ---------------------------------------------------------------------------
// Multiple metacodes on one line
// ---------------------------------------------------------------------------

describe('parseFileContent() — multi-metacode lines', () => {
  it('parses two codes on one line', () => {
    const raw = '<!-- section: Intro --><!-- speaker: Alice -->\nHello';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.deepEqual(lines, ['Hello']);
    assert.equal(lineCodes[0].section, 'Intro');
    assert.equal(lineCodes[0].speaker, 'Alice');
  });

  it('parses three codes on one line', () => {
    const raw = '<!-- section: Act1 --><!-- speaker: Host --><!-- lang: fi-FI -->\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].section, 'Act1');
    assert.equal(lineCodes[0].speaker, 'Host');
    assert.equal(lineCodes[0].lang, 'fi-FI');
  });

  it('mixed audio action + other code on one line: audio fires, other code persists', () => {
    const raw = '<!-- section: Intro --><!-- audio: start -->\nCaption';
    const { lines, lineCodes } = parseFileContent(raw);
    // audio action line produced + caption line
    assert.deepEqual(lines, ['', 'Caption']);
    assert.equal(lineCodes[0].audioCapture, 'start');
    assert.equal(lineCodes[0].section, 'Intro'); // section was set before audio action was emitted
    assert.equal(lineCodes[1].section, 'Intro'); // persists to caption
    assert.equal(lineCodes[1].audioCapture, undefined);
  });

  it('single-metacode lines still parse correctly (backward compat)', () => {
    const raw = '<!-- lang: en-US -->\nLine 1';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].lang, 'en-US');
  });

  it('multi-metacode line does not appear as a caption line', () => {
    const raw = '<!-- section: S1 --><!-- speaker: Bob -->\nCaption';
    const { lines } = parseFileContent(raw);
    assert.deepEqual(lines, ['Caption']);
  });
});
