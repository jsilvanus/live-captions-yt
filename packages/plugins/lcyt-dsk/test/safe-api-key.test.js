import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { safeApiKey } from '../src/db/images.js';

test('leaves a default randomUUID key unchanged (backward compatible)', () => {
  const key = randomUUID();               // 36 chars, [0-9a-f-]
  assert.equal(safeApiKey(key), key);
});

test('leaves any safe, short key unchanged', () => {
  assert.equal(safeApiKey('my-church-2024'), 'my-church-2024');
});

test('output matches the historical slice(0,40) for unaltered keys', () => {
  const key = 'a'.repeat(40);
  assert.equal(safeApiKey(key), key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40));
});

test('sanitizes unsafe characters and disambiguates with a hash', () => {
  assert.match(safeApiKey('my.church/key'), /^my_church_key-[0-9a-f]{8}$/);
});

test('distinct keys that sanitize identically do NOT collide', () => {
  assert.notEqual(safeApiKey('a.b'), safeApiKey('a/b'));
});

test('distinct long keys sharing a 40-char prefix do NOT collide', () => {
  const base = 'k'.repeat(40);
  assert.notEqual(safeApiKey(base + 'AAAA'), safeApiKey(base + 'BBBB'));
});

test('is deterministic and handles nullish input', () => {
  assert.equal(safeApiKey('a.b'), safeApiKey('a.b'));
  assert.equal(safeApiKey(''), '');
  assert.equal(safeApiKey(undefined), '');
});
