import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLines } from '../src/lib/normalizeLines.js';

describe('normalizeLines', () => {
  it('preserves heading lines and wraps following paragraph', () => {
    const raw = [
      '# 3faefa333 ###',
      "Today we're going to learn",
      'about YouTube live captions. Let me show',
      'you how this works. First, we need to set',
      'up our stream key. Welcome to the live',
      'stream! Then we can start sending captions',
    ];

    const res = normalizeLines(raw, 40);

    // First line must be the heading preserved
    assert.equal(res[0], '# 3faefa333 ###');

    // The following lines should be wrapped but not merged with the heading
    const following = res.slice(1).join('\n');
    assert.ok(following.includes("Today we're going to learn"), 'paragraph contains first words');
    // Ensure no lines contain the heading text again
    assert.ok(!res.slice(1).some(l => l.includes('# 3faefa333')),
      'heading should not be merged into paragraph lines');
  });
});
