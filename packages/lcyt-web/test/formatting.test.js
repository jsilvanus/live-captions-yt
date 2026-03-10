import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../src/lib/formatting.js';

describe('formatTime', () => {
  it('formats a valid ISO string as HH:MM:SS', () => {
    // Use a fixed date — just ensure it returns a string matching the 24-hour pattern.
    const result = formatTime('2026-03-10T14:05:09.000Z');
    assert.match(result, /^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns a formatted time for a numeric epoch (null → epoch 0)', () => {
    // new Date(null) → epoch 0, which is a valid date
    const result = formatTime(null);
    assert.match(result, /^\d{2}:\d{2}:\d{2}$/);
  });

  it('handles a Date-parseable numeric string', () => {
    const result = formatTime('2026-01-01T00:00:00.000Z');
    assert.match(result, /^\d{2}:\d{2}:\d{2}$/);
  });
});
