import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseValueTtl, parseDuration } from '../src/lib/metacode-ttl.js';

describe('parseDuration', () => {
  it('treats a bare number as seconds → milliseconds', () => {
    assert.equal(parseDuration('5'), 5000);
    assert.equal(parseDuration('0.5'), 500);
  });
  it('honours explicit ms/s/m units', () => {
    assert.equal(parseDuration('500ms'), 500);
    assert.equal(parseDuration('5s'), 5000);
    assert.equal(parseDuration('2m'), 120000);
    assert.equal(parseDuration('20 s'), 20000);
  });
  it('respects a custom defaultUnit', () => {
    assert.equal(parseDuration('500', { defaultUnit: 'ms' }), 500);
  });
  it('rejects zero, negative, captions, and junk', () => {
    assert.equal(parseDuration('0'), null);
    assert.equal(parseDuration('-1'), null);
    assert.equal(parseDuration('5c'), null); // captions is not a wall-clock duration
    assert.equal(parseDuration('abc'), null);
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration(null), null);
  });
});

describe('parseValueTtl', () => {
  it('should return no TTL for plain value without annotation', () => {
    const result = parseValueTtl('Prayer');
    assert.deepEqual(result, {
      value: 'Prayer',
      ttl: null
    });
  });

  it('should parse basic TTL with seconds unit and baseline revert', () => {
    const result = parseValueTtl('Prayer => 20s');
    assert.strictEqual(result.value, 'Prayer');
    assert.deepEqual(result.ttl, {
      ms: 20000,
      captions: null,
      revertMode: 'baseline',
      revertValue: null
    });
  });

  it('should parse TTL with literal revert value', () => {
    const result = parseValueTtl('Prayer => 20s:Hymn');
    assert.strictEqual(result.value, 'Prayer');
    assert.deepEqual(result.ttl, {
      ms: 20000,
      captions: null,
      revertMode: 'literal',
      revertValue: 'Hymn'
    });
  });

  it('should parse TTL without spaces around annotation', () => {
    const result = parseValueTtl('Prayer=>20s:Hymn');
    assert.strictEqual(result.value, 'Prayer');
    assert.deepEqual(result.ttl, {
      ms: 20000,
      captions: null,
      revertMode: 'literal',
      revertValue: 'Hymn'
    });
  });

  it('should parse TTL with previous revert mode', () => {
    const result = parseValueTtl('Prayer => 30s:~');
    assert.strictEqual(result.value, 'Prayer');
    assert.deepEqual(result.ttl, {
      ms: 30000,
      captions: null,
      revertMode: 'previous',
      revertValue: null
    });
  });

  it('should parse TTL with explicit empty revert value', () => {
    const result = parseValueTtl('Prayer => 20s:');
    assert.strictEqual(result.value, 'Prayer');
    assert.deepEqual(result.ttl, {
      ms: 20000,
      captions: null,
      revertMode: 'literal',
      revertValue: ''
    });
  });

  it('should parse caption unit', () => {
    const result = parseValueTtl('Live => 5c');
    assert.strictEqual(result.value, 'Live');
    assert.deepEqual(result.ttl, {
      ms: null,
      captions: 5,
      revertMode: 'baseline',
      revertValue: null
    });
  });

  it('should parse milliseconds unit', () => {
    const result = parseValueTtl('x => 500ms');
    assert.strictEqual(result.value, 'x');
    assert.deepEqual(result.ttl, {
      ms: 500,
      captions: null,
      revertMode: 'baseline',
      revertValue: null
    });
  });

  it('should parse minute unit', () => {
    const result = parseValueTtl('x => 2m');
    assert.strictEqual(result.value, 'x');
    assert.deepEqual(result.ttl, {
      ms: 120000,
      captions: null,
      revertMode: 'baseline',
      revertValue: null
    });
  });

  it('should parse decimal count', () => {
    const result = parseValueTtl('x => 1.5s');
    assert.strictEqual(result.value, 'x');
    assert.deepEqual(result.ttl, {
      ms: 1500,
      captions: null,
      revertMode: 'baseline',
      revertValue: null
    });
  });

  it('should parse with space before unit', () => {
    const result = parseValueTtl('x => 20 s');
    assert.strictEqual(result.value, 'x');
    assert.deepEqual(result.ttl, {
      ms: 20000,
      captions: null,
      revertMode: 'baseline',
      revertValue: null
    });
  });

  it('should not parse invalid annotation without unit', () => {
    const result = parseValueTtl('if x => y');
    assert.deepEqual(result, {
      value: 'if x => y',
      ttl: null
    });
  });

  it('should not parse annotation without unit specifier', () => {
    const result = parseValueTtl('score => 0');
    assert.deepEqual(result, {
      value: 'score => 0',
      ttl: null
    });
  });

  it('should reject zero count', () => {
    const result = parseValueTtl('a => 0s');
    assert.deepEqual(result, {
      value: 'a => 0s',
      ttl: null
    });
  });

  it('should parse last annotation when multiple are present', () => {
    const result = parseValueTtl('a => b => 20s');
    assert.strictEqual(result.value, 'a => b');
    assert.deepEqual(result.ttl, {
      ms: 20000,
      captions: null,
      revertMode: 'baseline',
      revertValue: null
    });
  });

  it('should handle whitespace around value and annotation', () => {
    const result = parseValueTtl('  Prayer  => 20s:Hello World  ');
    assert.strictEqual(result.value, 'Prayer');
    assert.deepEqual(result.ttl, {
      ms: 20000,
      captions: null,
      revertMode: 'literal',
      revertValue: 'Hello World'
    });
  });

  it('should handle empty string', () => {
    const result = parseValueTtl('');
    assert.deepEqual(result, {
      value: '',
      ttl: null
    });
  });

  it('should handle null input as empty string', () => {
    const result = parseValueTtl(null);
    assert.deepEqual(result, {
      value: '',
      ttl: null
    });
  });

  it('should handle undefined input as empty string', () => {
    const result = parseValueTtl(undefined);
    assert.deepEqual(result, {
      value: '',
      ttl: null
    });
  });
});
