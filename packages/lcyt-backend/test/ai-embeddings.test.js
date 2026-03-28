import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, isServerEmbeddingAvailable } from '../src/ai/embeddings.js';

describe('cosineSimilarity', () => {
  test('identical vectors return 1', () => {
    assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  });

  test('orthogonal vectors return 0', () => {
    const sim = cosineSimilarity([1, 0, 0], [0, 1, 0]);
    assert.ok(Math.abs(sim) < 0.001, `Expected ~0 but got ${sim}`);
  });

  test('opposite vectors return -1', () => {
    const sim = cosineSimilarity([1, 0], [-1, 0]);
    assert.ok(Math.abs(sim + 1) < 0.001, `Expected ~-1 but got ${sim}`);
  });

  test('returns 0 for empty vectors', () => {
    assert.equal(cosineSimilarity([], []), 0);
  });

  test('returns 0 for null inputs', () => {
    assert.equal(cosineSimilarity(null, [1, 2]), 0);
    assert.equal(cosineSimilarity([1, 2], null), 0);
  });

  test('returns 0 for mismatched lengths', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  test('similar vectors return high similarity', () => {
    const sim = cosineSimilarity([1, 2, 3], [1, 2, 3.1]);
    assert.ok(sim > 0.99, `Expected > 0.99 but got ${sim}`);
  });
});

describe('isServerEmbeddingAvailable', () => {
  test('returns false when EMBEDDING_API_KEY is not set', () => {
    const original = process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_API_KEY;
    assert.equal(isServerEmbeddingAvailable(), false);
    if (original) process.env.EMBEDDING_API_KEY = original;
  });
});
