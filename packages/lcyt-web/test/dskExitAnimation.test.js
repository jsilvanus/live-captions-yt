import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveExitAnimation, getAnimationTotalMs } from '../src/lib/dskExitAnimation.js';

// ── deriveExitAnimation ─────────────────────────────────────────────────────

describe('deriveExitAnimation', () => {
  it('returns empty string for empty/missing input', () => {
    assert.equal(deriveExitAnimation(''), '');
    assert.equal(deriveExitAnimation('   '), '');
    assert.equal(deriveExitAnimation(undefined), '');
    assert.equal(deriveExitAnimation(null), '');
  });

  it('maps lcyt-fadeIn to lcyt-fadeOut, preserving the rest of the shorthand', () => {
    assert.equal(
      deriveExitAnimation('lcyt-fadeIn 0.5s ease-out 0s 1 normal forwards'),
      'lcyt-fadeOut 0.5s ease-out 0s 1 normal forwards'
    );
  });

  it('maps lcyt-slideInLeft to lcyt-slideOutLeft', () => {
    assert.equal(
      deriveExitAnimation('lcyt-slideInLeft 0.6s ease-out 0s 1 normal forwards'),
      'lcyt-slideOutLeft 0.6s ease-out 0s 1 normal forwards'
    );
  });

  it('maps lcyt-slideInRight to lcyt-slideOutRight', () => {
    assert.equal(
      deriveExitAnimation('lcyt-slideInRight 1s linear'),
      'lcyt-slideOutRight 1s linear'
    );
  });

  it('maps lcyt-zoomIn to lcyt-zoomOut', () => {
    assert.equal(deriveExitAnimation('lcyt-zoomIn 0.3s'), 'lcyt-zoomOut 0.3s');
  });

  it('falls back to lcyt-fadeOut for presets with no natural reverse', () => {
    assert.equal(deriveExitAnimation('lcyt-pulse 1s infinite'), 'lcyt-fadeOut 1s infinite');
    assert.equal(deriveExitAnimation('lcyt-blink 0.5s'), 'lcyt-fadeOut 0.5s');
    assert.equal(deriveExitAnimation('lcyt-typewriter 2s'), 'lcyt-fadeOut 2s');
  });

  it('falls back to lcyt-fadeOut for slideInUp/Down (no slideOutUp/Down keyframes)', () => {
    assert.equal(deriveExitAnimation('lcyt-slideInUp 0.5s'), 'lcyt-fadeOut 0.5s');
    assert.equal(deriveExitAnimation('lcyt-slideInDown 0.5s'), 'lcyt-fadeOut 0.5s');
  });

  it('falls back to lcyt-fadeOut for *Out presets used as entry (already an exit preset)', () => {
    assert.equal(deriveExitAnimation('lcyt-fadeOut 0.5s'), 'lcyt-fadeOut 0.5s');
    assert.equal(deriveExitAnimation('lcyt-slideOutLeft 0.5s'), 'lcyt-fadeOut 0.5s');
  });

  it('falls back to lcyt-fadeOut for unknown preset names', () => {
    assert.equal(deriveExitAnimation('custom-anim 1s'), 'lcyt-fadeOut 1s');
  });

  it('handles a bare preset name with no other shorthand parts', () => {
    assert.equal(deriveExitAnimation('lcyt-fadeIn'), 'lcyt-fadeOut');
  });

  it('collapses internal whitespace when rejoining parts', () => {
    assert.equal(
      deriveExitAnimation('  lcyt-fadeIn   0.5s   ease  '),
      'lcyt-fadeOut 0.5s ease'
    );
  });
});

// ── getAnimationTotalMs ──────────────────────────────────────────────────────

describe('getAnimationTotalMs', () => {
  it('returns 300ms default for empty/missing input', () => {
    assert.equal(getAnimationTotalMs(''), 300);
    assert.equal(getAnimationTotalMs('   '), 300);
    assert.equal(getAnimationTotalMs(undefined), 300);
    assert.equal(getAnimationTotalMs(null), 300);
  });

  it('parses duration in seconds to milliseconds', () => {
    assert.equal(getAnimationTotalMs('lcyt-fadeIn 0.5s'), 500);
    assert.equal(getAnimationTotalMs('lcyt-fadeIn 2s'), 2000);
  });

  it('adds delay to duration', () => {
    assert.equal(getAnimationTotalMs('lcyt-fadeIn 0.5s ease-out 0.25s'), 750);
  });

  it('falls back to 300ms duration when duration is unparseable', () => {
    assert.equal(getAnimationTotalMs('lcyt-fadeIn xs'), 300);
  });

  it('treats missing delay as 0', () => {
    assert.equal(getAnimationTotalMs('lcyt-fadeIn 1s ease-out'), 1000);
  });

  it('rounds fractional totals', () => {
    assert.equal(getAnimationTotalMs('lcyt-fadeIn 0.333s ease-out 0.111s'), 444);
  });

  it('handles the full canonical shorthand', () => {
    assert.equal(
      getAnimationTotalMs('lcyt-slideInLeft 0.6s ease-out 0.2s 1 normal forwards'),
      800
    );
  });
});
