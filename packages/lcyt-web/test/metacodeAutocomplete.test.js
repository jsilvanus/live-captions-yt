/**
 * Unit tests for src/lib/metacodeAutocomplete.js — pure functions, no DOM.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMetacodeContext, getMetacodeOptions, applyMetacodeSuggestion } from '../src/lib/metacodeAutocomplete.js';

describe('getMetacodeContext()', () => {
  it('returns null when the cursor is not inside a comment', () => {
    assert.equal(getMetacodeContext('hello world', 5), null);
  });

  it('returns null once the comment is already closed before the cursor', () => {
    const text = '<!-- graphics:logo --> rest';
    assert.equal(getMetacodeContext(text, text.length), null);
  });

  it('detects the bare keyword stage right after "<!--"', () => {
    const text = '<!--';
    const ctx = getMetacodeContext(text, text.length);
    assert.deepEqual(ctx, { kind: 'keyword', query: '', matchStart: 4, matchEnd: 4 });
  });

  it('detects a partial keyword being typed', () => {
    const text = '<!-- gra';
    const ctx = getMetacodeContext(text, text.length);
    assert.equal(ctx.kind, 'keyword');
    assert.equal(ctx.query, 'gra');
    assert.equal(text.slice(ctx.matchStart, ctx.matchEnd), 'gra');
  });

  it('detects the viewport stage inside an unclosed bracket', () => {
    const text = '<!-- graphics[vert';
    const ctx = getMetacodeContext(text, text.length);
    assert.equal(ctx.kind, 'viewport');
    assert.equal(ctx.query, 'vert');
  });

  it('detects a second viewport name after a comma', () => {
    const text = '<!-- graphics[vertical-left,v2';
    const ctx = getMetacodeContext(text, text.length);
    assert.equal(ctx.kind, 'viewport');
    assert.equal(ctx.query, 'v2');
  });

  it('detects the value stage after "graphics:"', () => {
    const text = '<!-- graphics: lo';
    const ctx = getMetacodeContext(text, text.length);
    assert.equal(ctx.kind, 'value');
    assert.equal(ctx.query, 'lo');
  });

  it('detects the value stage with a closed viewport bracket', () => {
    const text = '<!-- graphics[vertical-left]: lo';
    const ctx = getMetacodeContext(text, text.length);
    assert.equal(ctx.kind, 'value');
    assert.equal(ctx.query, 'lo');
  });

  it('strips a leading "+" delta prefix from the value query', () => {
    const text = '<!-- graphics: +lo';
    const ctx = getMetacodeContext(text, text.length);
    assert.equal(ctx.kind, 'value');
    assert.equal(ctx.query, 'lo');
  });

  it('detects a second value after a comma', () => {
    const text = '<!-- graphics: logo,ban';
    const ctx = getMetacodeContext(text, text.length);
    assert.equal(ctx.kind, 'value');
    assert.equal(ctx.query, 'ban');
  });

  it('works mid-string, not just at end of text', () => {
    const text = '<!-- graphics: lo --> trailing text';
    const ctx = getMetacodeContext(text, 17); // cursor right after "lo"
    assert.equal(ctx.kind, 'value');
    assert.equal(ctx.query, 'lo');
  });

  it('returns null for an unrelated metacode keyword', () => {
    const text = '<!-- lang: en';
    assert.equal(getMetacodeContext(text, text.length), null);
  });
});

describe('getMetacodeOptions()', () => {
  it('returns [] for a null context', () => {
    assert.deepEqual(getMetacodeOptions(null, {}), []);
  });

  it('offers both graphics forms at the keyword stage with no query', () => {
    const options = getMetacodeOptions({ kind: 'keyword', query: '' }, {});
    assert.equal(options.length, 2);
    assert.ok(options.some(o => o.insertText === 'graphics: '));
    assert.ok(options.some(o => o.insertText === 'graphics['));
  });

  it('filters keyword options by the typed prefix', () => {
    const options = getMetacodeOptions({ kind: 'keyword', query: 'graphics[' }, {});
    assert.deepEqual(options.map(o => o.insertText), ['graphics[']);
  });

  it('lists viewport names plus landscape aliases, filtered by prefix', () => {
    const options = getMetacodeOptions(
      { kind: 'viewport', query: 'v' },
      { viewports: ['vertical-left', 'vertical-right', 'sidebar'] }
    );
    assert.deepEqual(options.map(o => o.label).sort(), ['vertical-left', 'vertical-right']);
  });

  it('includes landscape aliases in the unfiltered viewport list', () => {
    const options = getMetacodeOptions({ kind: 'viewport', query: '' }, { viewports: [] });
    assert.ok(options.some(o => o.label === 'landscape'));
    assert.ok(options.some(o => o.label === 'default'));
    assert.ok(options.some(o => o.label === 'main'));
  });

  it('lists image shorthand names filtered by prefix for the value stage', () => {
    const options = getMetacodeOptions(
      { kind: 'value', query: 'lo' },
      { shorthands: ['logo', 'lower-third', 'banner'] }
    );
    assert.deepEqual(options.map(o => o.label).sort(), ['logo', 'lower-third']);
  });
});

describe('applyMetacodeSuggestion()', () => {
  it('replaces the matched token and places the cursor right after it', () => {
    const text = '<!-- gra';
    const ctx = getMetacodeContext(text, text.length);
    const result = applyMetacodeSuggestion(text, ctx, 'graphics: ');
    assert.equal(result.text, '<!-- graphics: ');
    assert.equal(result.cursorPos, '<!-- graphics: '.length);
  });

  it('preserves trailing text after the replaced token', () => {
    const text = '<!-- graphics: lo,banner -->';
    const ctx = getMetacodeContext(text, 17); // "lo" ends at index 17
    const result = applyMetacodeSuggestion(text, ctx, 'logo');
    assert.equal(result.text, '<!-- graphics: logo,banner -->');
  });
});
