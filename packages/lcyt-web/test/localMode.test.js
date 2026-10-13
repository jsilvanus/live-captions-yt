import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalModeFeatures, isHiddenInLocalMode } from '../src/lib/localMode.js';

test('isLocalModeFeatures detects the local-mode feature', () => {
  assert.equal(isLocalModeFeatures(['local-mode', 'captions']), true);
  assert.equal(isLocalModeFeatures(['login', 'captions']), false);
  assert.equal(isLocalModeFeatures(null), false);
  assert.equal(isLocalModeFeatures(undefined), false);
});

test('isHiddenInLocalMode hides multi-user pages', () => {
  for (const path of ['/admin/users', '/admin', '/team', '/account', '/projects', '/projects/abc123']) {
    assert.equal(isHiddenInLocalMode(path), true, path);
  }
});

test('isHiddenInLocalMode keeps local pages and does not match look-alike prefixes', () => {
  for (const path of ['/', '/assets', '/setup', '/production', '/graphics/editor', '/projectsX', '/teams']) {
    assert.equal(isHiddenInLocalMode(path), false, path);
  }
});
