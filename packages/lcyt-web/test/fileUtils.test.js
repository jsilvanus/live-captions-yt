/**
 * Tests for parseFileContent() from src/lib/metacode-parser.js
 *
 * parseFileContent() is a pure function — no browser APIs required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileContent } from '../src/lib/metacode-parser.js';

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
  it('uses actual raw file line numbers (not sequential text-only count)', () => {
    const raw = '<!-- lang: fi-FI -->\nLine 1\nLine 2\n<!-- section: x -->\nLine 3';
    const { lineNumbers } = parseFileContent(raw);
    // Metadata lines are skipped; text lines are at raw positions 2, 3, 5
    assert.deepEqual(lineNumbers, [2, 3, 5]);
  });

  it('plain lines with no metadata have sequential 1-based line numbers', () => {
    const raw = 'First line\nSecond line\nThird line';
    const { lineNumbers } = parseFileContent(raw);
    assert.deepEqual(lineNumbers, [1, 2, 3]);
  });

  it('counts empty-send markers at their raw file position', () => {
    const raw = '_\nLine 1\nLine 2';
    const { lineNumbers } = parseFileContent(raw);
    assert.deepEqual(lineNumbers, [1, 2, 3]);
  });

  it('counts audio action lines at their raw file position', () => {
    const raw = '<!-- audio: start -->\nLine 1\n<!-- audio: stop -->';
    const { lineNumbers } = parseFileContent(raw);
    assert.deepEqual(lineNumbers, [1, 2, 3]);
  });

  it('gaps appear in line numbers when metadata lines are interspersed', () => {
    const raw = 'Line 1\n<!-- lang: fi-FI -->\nLine 2';
    const { lineNumbers } = parseFileContent(raw);
    // Line 1 is at raw pos 1, Line 2 is at raw pos 3 (metadata at pos 2 is skipped)
    assert.deepEqual(lineNumbers, [1, 3]);
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

// ---------------------------------------------------------------------------
// timer metacode (<!-- timer: N -->)
// ---------------------------------------------------------------------------

describe('parseFileContent() — timer metacode', () => {
  it('parses <!-- timer: 5 --> as an action line with timer=5', () => {
    const { lines, lineCodes } = parseFileContent('<!-- timer: 5 -->');
    assert.deepEqual(lines, ['']);
    assert.equal(lineCodes[0].timer, 5);
  });

  it('parses fractional timer values', () => {
    const { lineCodes } = parseFileContent('<!-- timer: 0.5 -->');
    assert.equal(lineCodes[0].timer, 0.5);
  });

  it('timer does NOT persist into currentCodes for subsequent lines', () => {
    const raw = '<!-- timer: 3 -->\nLine 1\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].timer, 3);
    assert.equal(lineCodes[1].timer, undefined);
    assert.equal(lineCodes[2].timer, undefined);
  });

  it('ignores timer with zero or negative values', () => {
    const raw0 = '<!-- timer: 0 -->\nLine 1';
    const rawNeg = '<!-- timer: -1 -->\nLine 1';
    const result0 = parseFileContent(raw0);
    const resultNeg = parseFileContent(rawNeg);
    // No action line should be created; only the text line
    assert.equal(result0.lines.length, 1);
    assert.equal(result0.lines[0], 'Line 1');
    assert.equal(result0.lineCodes[0].timer, undefined);
    assert.equal(resultNeg.lines.length, 1);
    assert.equal(resultNeg.lineCodes[0].timer, undefined);
  });

  it('timer action inherits currentCodes', () => {
    const raw = '<!-- lang: fi-FI -->\n<!-- timer: 2 -->\nLine 1';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].timer, 2);
    assert.equal(lineCodes[0].lang, 'fi-FI');
  });
});

// ---------------------------------------------------------------------------
// goto metacode (<!-- goto: N -->)
// ---------------------------------------------------------------------------

describe('parseFileContent() — goto metacode', () => {
  it('parses <!-- goto: 10 --> as an action line with goto=10', () => {
    const { lines, lineCodes } = parseFileContent('<!-- goto: 10 -->');
    assert.deepEqual(lines, ['']);
    assert.equal(lineCodes[0].goto, 10);
  });

  it('goto does NOT persist into currentCodes for subsequent lines', () => {
    const raw = '<!-- goto: 5 -->\nLine 1\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].goto, 5);
    assert.equal(lineCodes[1].goto, undefined);
  });

  it('ignores goto with zero or non-positive values', () => {
    assert.deepEqual(parseFileContent('<!-- goto: 0 -->\nLine 1').lines, ['Line 1']);
  });

  it('goto action inherits currentCodes', () => {
    const raw = '<!-- section: Intro -->\n<!-- goto: 3 -->\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].goto, 3);
    assert.equal(lineCodes[0].section, 'Intro');
    assert.equal(lineCodes[1].section, 'Intro');
    assert.equal(lineCodes[1].goto, undefined);
  });
});

// ---------------------------------------------------------------------------
// file metacode (<!-- file: name --> and <!-- file[server]: path -->)
// ---------------------------------------------------------------------------

describe('parseFileContent() — file metacode', () => {
  it('parses <!-- file: My Script.txt --> as an action line with fileSwitch', () => {
    const { lines, lineCodes } = parseFileContent('<!-- file: My Script.txt -->');
    assert.deepEqual(lines, ['']);
    assert.equal(lineCodes[0].fileSwitch, 'My Script.txt');
  });

  it('fileSwitch does NOT persist into currentCodes for subsequent lines', () => {
    const raw = '<!-- file: other.txt -->\nLine 1\nLine 2';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].fileSwitch, 'other.txt');
    assert.equal(lineCodes[1].fileSwitch, undefined);
  });

  it('parses <!-- file[server]: /path/to/file --> as fileSwitchServer', () => {
    const { lines, lineCodes } = parseFileContent('<!-- file[server]: /path/to/file -->');
    assert.deepEqual(lines, ['']);
    assert.equal(lineCodes[0].fileSwitchServer, '/path/to/file');
  });

  it('file[server] with full URL', () => {
    const { lineCodes } = parseFileContent('<!-- file[server]: https://example.com/script.txt -->');
    assert.equal(lineCodes[0].fileSwitchServer, 'https://example.com/script.txt');
  });

  it('file and file[server] do NOT persist', () => {
    const raw = '<!-- file[server]: /data/file -->\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].fileSwitchServer, '/data/file');
    assert.equal(lineCodes[1].fileSwitchServer, undefined);
  });

  it('file action inherits currentCodes', () => {
    const raw = '<!-- section: Act1 -->\n<!-- file: part2.txt -->\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].fileSwitch, 'part2.txt');
    assert.equal(lineCodes[0].section, 'Act1');
    assert.equal(lineCodes[1].section, 'Act1');
    assert.equal(lineCodes[1].fileSwitch, undefined);
  });
});

// ---------------------------------------------------------------------------
// Combined action metacodes on one line
// ---------------------------------------------------------------------------

describe('parseFileContent() — combined action metacodes', () => {
  it('audio and timer on same line produce one action entry with both flags', () => {
    const raw = '<!-- audio: start --><!-- timer: 5 -->\nCaption';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.deepEqual(lines, ['', 'Caption']);
    assert.equal(lineCodes[0].audioCapture, 'start');
    assert.equal(lineCodes[0].timer, 5);
  });

  it('goto and timer on same line produce one action entry', () => {
    const raw = '<!-- goto: 3 --><!-- timer: 2 -->\nCaption';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].goto, 3);
    assert.equal(lineCodes[0].timer, 2);
  });
});

// ---------------------------------------------------------------------------
// Cue metacode parsing
// ---------------------------------------------------------------------------

describe('parseFileContent() — cue metacodes', () => {
  it('standalone cue creates an entry with empty text and cue property', () => {
    const raw = '<!-- cue:Amen -->\nLet us pray';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], '');
    assert.equal(lineCodes[0].cue, 'Amen');
    assert.equal(lines[1], 'Let us pray');
  });

  it('preserves cue phrase case', () => {
    const raw = '<!-- cue:Prayer Start -->';
    const { lineCodes } = parseFileContent(raw);
    assert.equal(lineCodes[0].cue, 'Prayer Start');
  });

  it('parses multiple cue entries at different positions', () => {
    const raw = '<!-- cue:Amen -->\nLine 1\n<!-- cue:Hallelujah -->\nLine 2';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 4);
    assert.equal(lineCodes[0].cue, 'Amen');
    assert.equal(lineCodes[2].cue, 'Hallelujah');
  });

  it('ignores empty cue value', () => {
    const raw = '<!-- cue: -->\nLine 1';
    const { lines } = parseFileContent(raw);
    // Empty cue should not create an action entry; only Line 1
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'Line 1');
  });

  it('cue combined with other persistent codes on same line', () => {
    const raw = '<!-- section: Prayer --><!-- cue:Amen -->\nLet us pray';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 2);
    assert.equal(lineCodes[0].cue, 'Amen');
    assert.equal(lineCodes[0].section, 'Prayer');
  });

  it('cue inline with content — strips cue and keeps text', () => {
    const raw = '<!-- cue:Amen -->Let us pray';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'Let us pray');
    assert.equal(lineCodes[0].cue, 'Amen');
  });

  it('cue at end of content line', () => {
    const raw = 'Let us pray<!-- cue:Amen -->';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'Let us pray');
    assert.equal(lineCodes[0].cue, 'Amen');
  });

  it('cue with other metacodes and content on same line — non-cue metadata stays in text', () => {
    // When non-cue metacodes are inline with content text, they remain in the text
    // because the parser only strips cue metacodes inline. Other metadata should
    // be placed on their own preceding line for proper processing.
    const raw = '<!-- section: Closing --><!-- cue:Amen -->Let us pray';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 1);
    // section comment stays in text (parser limitation for mixed lines)
    assert.equal(lines[0], '<!-- section: Closing -->Let us pray');
    assert.equal(lineCodes[0].cue, 'Amen');
  });

  it('cue with metadata on preceding line and content inline', () => {
    const raw = '<!-- section: Closing -->\n<!-- cue:Amen -->Let us pray';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'Let us pray');
    assert.equal(lineCodes[0].cue, 'Amen');
    assert.equal(lineCodes[0].section, 'Closing');
  });

  it('content lines without cue are unaffected', () => {
    const raw = 'Hello world\n<!-- cue:Test -->Jump here\nGoodbye';
    const { lines, lineCodes } = parseFileContent(raw);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'Hello world');
    assert.equal(lineCodes[0].cue, undefined);
    assert.equal(lines[1], 'Jump here');
    assert.equal(lineCodes[1].cue, 'Test');
    assert.equal(lines[2], 'Goodbye');
    assert.equal(lineCodes[2].cue, undefined);
  });
});
