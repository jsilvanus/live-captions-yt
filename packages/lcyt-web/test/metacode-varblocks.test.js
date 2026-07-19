import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVarBlockMarker, wrapValue, expandVarBlocks, hasVarBlocks, pendingVarBlockNames } from '../src/lib/metacode-varblocks.js';

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

  it('freeze: an already-materialized block is reused verbatim when a sibling pending block resolves, even if its own variable value has since drifted', () => {
    const lines = ['{{a[20]}}', '{{b[20]}}'];
    const lineCodes = [
      { varBlock: { name: 'a', maxLen: 20, hard: false } },
      { varBlock: { name: 'b', maxLen: 20, hard: false } },
    ];
    const lineNumbers = [1, 2];

    // First pass: `a` resolves, `b` is still pending.
    const first = expandVarBlocks(lines, lineCodes, lineNumbers, { a: 'original value' });
    assert.equal(first.lines[0], 'original value');
    assert.equal(first.lineCodes[1].varBlockPending, true);

    // Second pass (simulating a reparse triggered by `b` resolving): `a`'s
    // *live* value has since changed, but `a`'s block was already frozen —
    // it must come back unchanged, not reflowed with the new value.
    const second = expandVarBlocks(lines, lineCodes, lineNumbers, { a: 'CHANGED value', b: 'now resolved' }, {
      previous: { lines: first.lines, lineCodes: first.lineCodes, lineNumbers: first.lineNumbers },
    });
    assert.equal(second.lines[0], 'original value'); // frozen — not "CHANGED value"
    assert.equal(second.lineCodes[0].virtual, true);
    assert.ok(second.lines.includes('now resolved')); // b materialized fresh
  });

  it('without `previous`, a reparse recomputes every block from the live snapshot (no accidental freeze)', () => {
    const lines = ['{{a[20]}}'];
    const lineCodes = [{ varBlock: { name: 'a', maxLen: 20, hard: false } }];
    const lineNumbers = [1];
    const first = expandVarBlocks(lines, lineCodes, lineNumbers, { a: 'original' });
    const second = expandVarBlocks(lines, lineCodes, lineNumbers, { a: 'changed' }); // no opts.previous
    assert.equal(first.lines[0], 'original');
    assert.equal(second.lines[0], 'changed');
  });

  it('a still-pending block in `previous` is not treated as frozen — it gets a fresh shot at resolving', () => {
    const lines = ['{{a[20]}}'];
    const lineCodes = [{ varBlock: { name: 'a', maxLen: 20, hard: false } }];
    const lineNumbers = [1];
    const pending = expandVarBlocks(lines, lineCodes, lineNumbers, {}); // still unresolved
    const resolved = expandVarBlocks(lines, lineCodes, lineNumbers, { a: 'now resolved' }, {
      previous: { lines: pending.lines, lineCodes: pending.lineCodes, lineNumbers: pending.lineNumbers },
    });
    assert.equal(resolved.lines[0], 'now resolved');
    assert.equal(resolved.lineCodes[0].virtual, true);
  });

  it('one-shot codes (timer, apiTriggers, goto, cue, actions) stay only on the first virtual segment', () => {
    const lines = ['{{quote[10]}}'];
    const lineCodes = [{
      section: 'Sermon', timer: 5, goto: 42,
      apiTriggers: [{ connectorSlug: 'weather', requestSlug: 'current', tier: 'prefetch' }],
      cue: 'Amen', cueMode: 'next',
      actions: [{ key: 'audio', value: 'start' }],
      varBlock: { name: 'quote', maxLen: 10, hard: false },
    }];
    const out = expandVarBlocks(lines, lineCodes, [7], { quote: 'the quick brown fox' });
    assert.equal(out.lines.length, 2); // two wrapped segments
    // First segment: keeps everything (persistent + one-shot).
    assert.equal(out.lineCodes[0].section, 'Sermon');
    assert.equal(out.lineCodes[0].timer, 5);
    assert.equal(out.lineCodes[0].goto, 42);
    assert.ok(out.lineCodes[0].apiTriggers);
    assert.equal(out.lineCodes[0].cue, 'Amen');
    assert.ok(out.lineCodes[0].actions);
    // Second segment: persistent code stays, one-shot/trigger codes are stripped
    // so they don't re-fire as the operator advances through the block.
    assert.equal(out.lineCodes[1].section, 'Sermon');
    assert.equal(out.lineCodes[1].timer, undefined);
    assert.equal(out.lineCodes[1].goto, undefined);
    assert.equal(out.lineCodes[1].apiTriggers, undefined);
    assert.equal(out.lineCodes[1].cue, undefined);
    assert.equal(out.lineCodes[1].cueMode, undefined);
    assert.equal(out.lineCodes[1].actions, undefined);
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

describe('pendingVarBlockNames()', () => {
  it('collects the variable names of still-pending blocks', () => {
    const lineCodes = [
      { varBlock: { name: 'weather', maxLen: 10, hard: false } },
      { section: 'x' },
      { varBlock: { name: 'quote', maxLen: 20, hard: false } },
    ];
    assert.deepEqual(pendingVarBlockNames(lineCodes).sort(), ['quote', 'weather']);
  });

  it('dedupes repeated names', () => {
    const lineCodes = [
      { varBlock: { name: 'weather', maxLen: 10, hard: false } },
      { varBlock: { name: 'weather', maxLen: 20, hard: false } },
    ];
    assert.deepEqual(pendingVarBlockNames(lineCodes), ['weather']);
  });

  it('ignores already-resolved (virtual) lines — no varBlock key survives expansion', () => {
    assert.deepEqual(pendingVarBlockNames([{ virtual: true, virtualBlock: 'weather' }]), []);
  });

  it('returns [] for no pending blocks', () => {
    assert.deepEqual(pendingVarBlockNames([{}, { section: 'x' }]), []);
  });
});
