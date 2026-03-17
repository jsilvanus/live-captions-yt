/**
 * Tests for translate() and getMessages() from src/lib/i18n.js
 *
 * getStoredLang() and storeLang() use localStorage/navigator — browser-only,
 * not tested here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translate, getMessages } from '../src/lib/i18n.js';

// ---------------------------------------------------------------------------
// getMessages()
// ---------------------------------------------------------------------------

describe('getMessages()', () => {
  it('returns an object for "en"', () => {
    const msgs = getMessages('en');
    assert.ok(msgs && typeof msgs === 'object');
  });

  it('returns an object for "fi"', () => {
    const msgs = getMessages('fi');
    assert.ok(msgs && typeof msgs === 'object');
  });

  it('returns an object for "sv"', () => {
    const msgs = getMessages('sv');
    assert.ok(msgs && typeof msgs === 'object');
  });

  it('falls back to English for unknown locale', () => {
    const en = getMessages('en');
    const unknown = getMessages('zz');
    // Should get the same object as English
    assert.deepEqual(unknown, en);
  });
});

// ---------------------------------------------------------------------------
// translate()
// ---------------------------------------------------------------------------

describe('translate()', () => {
  const msgs = getMessages('en');

  it('returns a top-level string value', () => {
    // settings is a nested object; try a known top-level direct string if any
    // Use a nested key known to exist in en.js
    const result = translate(msgs, 'settings.title');
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
    assert.notEqual(result, 'settings.title'); // should not return the key
  });

  it('returns a nested dot-path value', () => {
    const result = translate(msgs, 'settings.connection.backendUrl');
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
  });

  it('returns the key as fallback when path does not exist', () => {
    const result = translate(msgs, 'nonexistent.deeply.nested.key');
    assert.equal(result, 'nonexistent.deeply.nested.key');
  });

  it('returns the key when value is an object (not a leaf string)', () => {
    // 'settings' is an object, not a string
    const result = translate(msgs, 'settings');
    assert.equal(result, 'settings');
  });

  it('returns the key when messages is null', () => {
    const result = translate(null, 'settings.title');
    assert.equal(result, 'settings.title');
  });

  it('returns the key for empty messages object', () => {
    const result = translate({}, 'settings.title');
    assert.equal(result, 'settings.title');
  });

  it('handles single-segment keys', () => {
    // Any direct string key at top level
    const customMsgs = { greeting: 'Hello' };
    const result = translate(customMsgs, 'greeting');
    assert.equal(result, 'Hello');
  });

  it('handles deep nesting', () => {
    const customMsgs = { a: { b: { c: 'deep value' } } };
    const result = translate(customMsgs, 'a.b.c');
    assert.equal(result, 'deep value');
  });
});
