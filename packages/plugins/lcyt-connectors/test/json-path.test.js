import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateJsonPath } from '../src/json-path.js';

describe('evaluateJsonPath', () => {
  test("'$' returns the whole body", () => {
    const data = { a: 1 };
    assert.deepEqual(evaluateJsonPath(data, '$'), data);
  });

  test('dot access into a nested object', () => {
    assert.equal(evaluateJsonPath({ foo: { bar: 42 } }, '$.foo.bar'), 42);
  });

  test('bracket numeric index into an array', () => {
    assert.equal(evaluateJsonPath({ items: [{ name: 'first' }, { name: 'second' }] }, '$.items[1].name'), 'second');
  });

  test('bracket quoted key access', () => {
    assert.equal(evaluateJsonPath({ 'weird key': 5 }, "$['weird key']"), 5);
  });

  test('returns undefined when path does not resolve', () => {
    assert.equal(evaluateJsonPath({ a: 1 }, '$.b.c'), undefined);
  });

  test('returns undefined when traversing through null', () => {
    assert.equal(evaluateJsonPath({ a: null }, '$.a.b'), undefined);
  });
});
