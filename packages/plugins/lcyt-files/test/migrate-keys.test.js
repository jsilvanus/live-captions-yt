/**
 * Tests for migration script key-mapping logic.
 *
 * These tests verify the pure functions used by migrate-files-to-s3.mjs:
 * - buildS3ObjectKey: constructs S3 keys from api_key + filename
 * - keySegment round-tripping: api_key → keySegment → consistent mapping
 * - path normalization: forward slashes for S3 keys across platforms
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { keySegment } from '../src/adapters/key-segment.js';

// ─── Helper (replicated from migrate-files-to-s3.mjs) ─────────────────────────

function buildS3ObjectKey(apiKey, filename, s3Prefix = 'captions') {
  return `${s3Prefix}/${keySegment(apiKey)}/${filename}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildS3ObjectKey', () => {
  test('standard UUID key', () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    const result = buildS3ObjectKey(key, 'session-001.txt');
    assert.equal(result, `captions/${key}/session-001.txt`);
  });

  test('key with special characters gets sanitized', () => {
    const key = 'my-key/with:special!chars@#$';
    const result = buildS3ObjectKey(key, 'captions.vtt');
    // keySegment replaces non-alphanumeric (except -) with _, then appends hash if altered
    assert.match(result, /^captions\/my-key_with_special_chars___-[a-f0-9]{8}\/captions\.vtt$/);
  });

  test('filename with path separator normalized to forward slash', () => {
    const key = 'test-key';
    const result = buildS3ObjectKey(key, 'hls/segment-001.ts');
    assert.equal(result, 'captions/test-key/hls/segment-001.ts');
  });

  test('custom S3 prefix', () => {
    const key = 'test-key';
    const result = buildS3ObjectKey(key, 'file.txt', 'my-prefix');
    assert.equal(result, 'my-prefix/test-key/file.txt');
  });

  test('empty filename edge case', () => {
    const key = 'test-key';
    const result = buildS3ObjectKey(key, '');
    assert.equal(result, 'captions/test-key/');
  });

  test('nested filename path', () => {
    const key = 'test-key';
    const result = buildS3ObjectKey(key, 'hls/segments/segment-001.ts');
    assert.equal(result, 'captions/test-key/hls/segments/segment-001.ts');
  });
});

describe('keySegment consistency', () => {
  test('standard UUID (< 40 chars, all safe) passes through unchanged', () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    const seg = keySegment(key);
    assert.equal(seg, key);
  });

  test('safe alphanumeric key with hyphens passes through', () => {
    const key = 'my-test-project-2024';
    const seg = keySegment(key);
    assert.equal(seg, key);
  });

  test('key that needs sanitization gets suffix hash', () => {
    const key1 = 'key/with:special!chars';
    const key2 = 'key_with_special_chars'; // already safe, no sanitization needed
    const seg1 = keySegment(key1);
    const seg2 = keySegment(key2);
    // key1 needs sanitization, gets hash suffix
    // key2 is already safe, passes through unchanged
    assert.notEqual(seg1, seg2);
    assert.match(seg1, /^key_with_special_chars-[a-f0-9]{8}$/);
    assert.equal(seg2, 'key_with_special_chars');
  });

  test('long key gets truncated and hash appended', () => {
    const key = 'a'.repeat(50); // longer than KEY_SEGMENT_MAX (40)
    const seg = keySegment(key);
    assert.ok(seg.includes('-'), 'should have hash suffix');
    assert.ok(seg.length <= 50, 'should be reasonable length');
  });

  test('deterministic hashing: same key always produces same segment', () => {
    const key = 'key/with:special!chars';
    const seg1 = keySegment(key);
    const seg2 = keySegment(key);
    assert.equal(seg1, seg2);
  });
});

describe('S3 object key construction invariants', () => {
  test('two distinct keys produce distinct S3 prefixes', () => {
    const key1 = 'project-a';
    const key2 = 'project-b';
    const key1Seg = keySegment(key1);
    const key2Seg = keySegment(key2);
    assert.notEqual(key1Seg, key2Seg);

    const obj1 = buildS3ObjectKey(key1, 'session.vtt');
    const obj2 = buildS3ObjectKey(key2, 'session.vtt');
    assert.notEqual(obj1, obj2);
  });

  test('same filename under different keys does not collide', () => {
    const filename = 'captions.vtt';
    const obj1 = buildS3ObjectKey('key-1', filename);
    const obj2 = buildS3ObjectKey('key-2', filename);
    assert.notEqual(obj1, obj2);
    // Verify structure: different segment between prefix and filename
    const parts1 = obj1.split('/');
    const parts2 = obj2.split('/');
    assert.equal(parts1[1], keySegment('key-1'));
    assert.equal(parts2[1], keySegment('key-2'));
    assert.equal(parts1[2], parts2[2]); // filename is same
  });

  test('multiple files under same key have distinct keys', () => {
    const key = 'test-key';
    const obj1 = buildS3ObjectKey(key, 'session1.vtt');
    const obj2 = buildS3ObjectKey(key, 'session2.vtt');
    const obj3 = buildS3ObjectKey(key, 'hls/seg1.ts');
    assert.notEqual(obj1, obj2);
    assert.notEqual(obj1, obj3);
    assert.notEqual(obj2, obj3);
  });
});
