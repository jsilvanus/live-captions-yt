import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, interpolatePairs, extractVariableNames } from '../src/interpolate.js';

describe('interpolate', () => {
  test('replaces {{name}} with snapshot value', () => {
    assert.equal(interpolate('Hello {{name}}!', { name: 'World' }), 'Hello World!');
  });

  test('missing variable renders as empty string', () => {
    assert.equal(interpolate('Hello {{missing}}!', {}), 'Hello !');
  });

  test('multiple references, some missing', () => {
    assert.equal(interpolate('{{a}}-{{b}}-{{c}}', { a: '1', c: '3' }), '1--3');
  });

  test('non-string input passes through unchanged', () => {
    assert.equal(interpolate(null, {}), null);
    assert.equal(interpolate(undefined, {}), undefined);
  });

  test('text with no {{ }} is untouched (fast path)', () => {
    assert.equal(interpolate('plain text', { a: '1' }), 'plain text');
  });
});

describe('interpolatePairs', () => {
  test('interpolates each pair value, keeps key', () => {
    const result = interpolatePairs([{ key: 'Authorization', value: 'Bearer {{token}}' }], { token: 'abc123' });
    assert.deepEqual(result, [{ key: 'Authorization', value: 'Bearer abc123' }]);
  });

  test('non-array input returns empty array', () => {
    assert.deepEqual(interpolatePairs(null, {}), []);
  });
});

describe('extractVariableNames', () => {
  test('finds all unique variable names referenced in a string', () => {
    assert.deepEqual(extractVariableNames('{{a}} and {{b}} and {{a}} again'), ['a', 'b']);
  });

  test('returns empty array when none referenced', () => {
    assert.deepEqual(extractVariableNames('no vars here'), []);
  });
});
