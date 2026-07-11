import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { keySegment, KEY_SEGMENT_MAX } from '../src/adapters/key-segment.js';

test('leaves a default randomUUID key unchanged (backward compatible)', () => {
  const key = randomUUID();               // 36 chars, [0-9a-f-]
  assert.equal(keySegment(key), key);
});

test('leaves any safe, short key unchanged', () => {
  assert.equal(keySegment('my-church-2024'), 'my-church-2024');
  assert.equal(keySegment('ABC123'), 'ABC123');
});

test('output matches the historical slice(0,40) for unaltered keys', () => {
  const key = 'a'.repeat(40);
  assert.equal(keySegment(key), key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40));
});

test('sanitizes unsafe characters', () => {
  const seg = keySegment('my.church/key');
  assert.match(seg, /^my_church_key-[0-9a-f]{8}$/);
});

test('distinct keys that sanitize identically do NOT collide', () => {
  // Both sanitize to "a_b" under the old scheme — would share a directory.
  const a = keySegment('a.b');
  const b = keySegment('a/b');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('a_b-'));
  assert.ok(b.startsWith('a_b-'));
});

test('distinct long keys sharing a 40-char prefix do NOT collide', () => {
  const base = 'k'.repeat(40);
  const a = keySegment(base + 'AAAA');
  const b = keySegment(base + 'BBBB');
  assert.notEqual(a, b);
});

test('is deterministic', () => {
  assert.equal(keySegment('a.b'), keySegment('a.b'));
});

test('bounds the sanitized portion to KEY_SEGMENT_MAX', () => {
  const seg = keySegment('x'.repeat(200));
  // 40-char sanitized body + '-' + 8-char hash
  assert.equal(seg.length, KEY_SEGMENT_MAX + 1 + 8);
});

test('handles empty / nullish keys without throwing', () => {
  assert.equal(keySegment(''), '');
  assert.equal(keySegment(undefined), '');
  assert.equal(keySegment(null), '');
});
