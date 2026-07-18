import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVarBlockMarker, wrapValue, expandVarBlocks, hasVarBlocks } from '../src/lib/metacode-varblocks.js';

describe('parseVarBlockMarker()', () => {
  it('parses a soft-wrap block marker', () => {
    assert.deepEqual(parseVarBlockMarker('{{quote[40]}}'), { name: 'quote', maxLen: 40, hard: false });
  });

  it('parses a hard-wrap block marker', () => {
    assert.deepEqual(parseVarBlockMarker('{{quote[40*]}}'), { name: 'quote', maxLen: 40, hard: true });
  });

  it('tolerates surrounding whitespace and internal spacing', () => {
    assert.deepEqual(parseVarBlockMarker('  {{ quote[40] }}  '), { name: 'quote', maxLen: 40, hard: false });
  });

  it('rejects plain {{name}} (no bracket)', () => {
    assert.equal(parseVarBlockMarker('{{quote}}'), null);
  });

  it('rejects the marker mixed with other text — block-only', () => {
    assert.equal(parseVarBlockMarker('Quote: {{quote[40]}}'), null);
  });

  it('rejects a zero-length wrap', () => {
    assert.equal(parseVarBlockMarker('{{quote[0]}}'), null);
  });

  it('rejects non-numeric/invalid brackets', () => {
    assert.equal(parseVarBlockMarker('{{quote[abc]}}'), null);
  });
});

describe('wrapValue() — soft wrap', () => {
  it('breaks at the closest whitespace before maxLen', () => {
    assert.deepEqual(wrapValue('the quick brown fox jumps', 10, false), ['the quick', 'brown fox', 'jumps']);
  });

  it('hard-slices a single word longer than maxLen', () => {
    assert.deepEqual(wrapValue('supercalifragilisticexpialidocious', 10, false), [
      'supercalif', 'ragilistic', 'expialidoc', 'ious',
    ]);
  });

  it('returns a single empty line for an empty value', () => {
    assert.deepEqual(wrapValue('', 10, false), ['']);
    assert.deepEqual(wrapValue(null, 10, false), ['']);
    assert.deepEqual(wrapValue(undefined, 10, false), ['']);
  });

  it('returns one line when the value already fits', () => {
    assert.deepEqual(wrapValue('short', 40, false), ['short']);
  });
});

describe('wrapValue() — hard wrap', () => {
  it('slices at exactly maxLen characters regardless of words', () => {
    assert.deepEqual(wrapValue('abcdefghij', 4, true), ['abcd', 'efgh', 'ij']);
  });

  it('does not respect whitespace boundaries', () => {
    assert.deepEqual(wrapValue('ab cd ef', 3, true), ['ab ', 'cd ', 'ef']);
  });
});

describe('expandVarBlocks()', () => {
  it('passes non-block lines through unchanged', () => {
    const out = expandVarBlocks(['hello'], [{}], [1], {});
    assert.deepEqual(out, { lines: ['hello'], lineCodes: [{}], lineNumbers: [1] });
  });

  it('expands a resolved block into wrapped virtual lines sharing the source line number', () => {
    const lines = ['{{quote[10]}}'];
    const lineCodes = [{ section: 'Sermon', varBlock: { name: 'quote', maxLen: 10, hard: false } }];
    const lineNumbers = [7];
    const out = expandVarBlocks(lines, lineCodes, lineNumbers, { quote: 'the quick brown fox' });
    assert.deepEqual(out.lines, ['the quick', 'brown fox']);
    assert.deepEqual(out.lineNumbers, [7, 7]);
    assert.equal(out.lineCodes[0].section, 'Sermon');
    assert.equal(out.lineCodes[0].virtual, true);
    assert.equal(out.lineCodes[0].virtualBlock, 'quote');
    assert.equal(out.lineCodes[0].virtualIndex, 0);
    assert.equal(out.lineCodes[1].virtualIndex, 1);
    assert.equal(out.lineCodes[0].varBlock, undefined);
  });

  it('emits a pending placeholder for an unresolved variable, tagged for retry', () => {
    const lines = ['{{quote[10]}}'];
    const lineCodes = [{ varBlock: { name: 'quote', maxLen: 10, hard: false } }];
    const out = expandVarBlocks(lines, lineCodes, [3], {});
    assert.equal(out.lines.length, 1);
    assert.match(out.lines[0], /loading…/);
    assert.equal(out.lineCodes[0].varBlockPending, true);
    assert.deepEqual(out.lineCodes[0].varBlock, { name: 'quote', maxLen: 10, hard: false });
  });

  it('defaults variablesSnapshot to {} (nothing resolved)', () => {
    const lines = ['{{quote[10]}}'];
    const lineCodes = [{ varBlock: { name: 'quote', maxLen: 10, hard: false } }];
    const out = expandVarBlocks(lines, lineCodes, [1]);
    assert.equal(out.lineCodes[0].varBlockPending, true);
  });
});

describe('hasVarBlocks()', () => {
  it('detects a pending block (varBlock survives expansion)', () => {
    const lineCodes = [{ varBlock: { name: 'x', maxLen: 10, hard: false }, varBlockPending: true }];
    assert.equal(hasVarBlocks(lineCodes), true);
  });

  it('does not flag an already-resolved (expanded) block', () => {
    const lineCodes = [{ virtual: true, virtualBlock: 'x' }];
    assert.equal(hasVarBlocks(lineCodes), false);
  });

  it('returns false for plain lines', () => {
    assert.equal(hasVarBlocks([{}, { section: 'x' }]), false);
  });
});
