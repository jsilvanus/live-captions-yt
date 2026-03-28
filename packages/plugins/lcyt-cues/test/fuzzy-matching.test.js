import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Fuzzy matching tests — pure functions, no DB required
// ---------------------------------------------------------------------------

let jaroWinkler, fuzzyWordMatch;

before(async () => {
  ({ jaroWinkler, fuzzyWordMatch } = await import('../src/cue-engine.js'));
});

describe('jaroWinkler — backend', () => {
  test('returns 1.0 for identical strings', () => {
    assert.equal(jaroWinkler('amen', 'amen'), 1.0);
  });

  test('returns 0 for empty vs non-empty', () => {
    assert.equal(jaroWinkler('', 'test'), 0);
    assert.equal(jaroWinkler('test', ''), 0);
  });

  test('returns 1.0 for both empty', () => {
    assert.equal(jaroWinkler('', ''), 1.0);
  });

  test('returns high score for similar words', () => {
    const s = jaroWinkler('beseech', 'bseeech');
    assert.ok(s > 0.85, `Expected > 0.85, got ${s}`);
  });

  test('returns lower score for dissimilar words', () => {
    const s = jaroWinkler('hallelujah', 'goodbye');
    assert.ok(s < 0.6, `Expected < 0.6, got ${s}`);
  });

  test('catches common STT variations', () => {
    // "ah men" vs "amen"
    const s1 = jaroWinkler('amen', 'ameen');
    assert.ok(s1 > 0.8, `Expected amen/ameen > 0.8, got ${s1}`);

    // "alleluia" vs "hallelujah"
    const s2 = jaroWinkler('hallelujah', 'alleluia');
    assert.ok(s2 > 0.6, `Expected hallelujah/alleluia > 0.6, got ${s2}`);
  });
});

describe('fuzzyWordMatch — backend', () => {
  test('exact word match returns score 1.0', () => {
    const { score } = fuzzyWordMatch('amen', 'amen');
    assert.equal(score, 1.0);
  });

  test('exact multi-word match returns score 1.0', () => {
    const { score } = fuzzyWordMatch('we beseech thee', 'we beseech thee o lord');
    assert.equal(score, 1.0);
  });

  test('slides window to find best match', () => {
    const { score, matched } = fuzzyWordMatch('beseech thee', 'o lord we beseech thee hear our prayer');
    assert.equal(score, 1.0);
    assert.equal(matched, 'beseech thee');
  });

  test('returns high score for similar words', () => {
    const { score } = fuzzyWordMatch('beseech thee', 'bseeech thee');
    assert.ok(score > 0.85, `Expected > 0.85, got ${score}`);
  });

  test('returns low score for unrelated text', () => {
    const { score } = fuzzyWordMatch('hallelujah praise', 'the cat sat on mat');
    assert.ok(score < 0.7, `Expected < 0.7, got ${score}`);
  });

  test('returns 0 for empty inputs', () => {
    assert.equal(fuzzyWordMatch('', 'test').score, 0);
    assert.equal(fuzzyWordMatch('test', '').score, 0);
    assert.equal(fuzzyWordMatch('', '').score, 0);
  });

  test('single word match against longer text', () => {
    const { score, matched } = fuzzyWordMatch('amen', 'and all the people said amen');
    assert.equal(score, 1.0);
    assert.equal(matched, 'amen');
  });
});
