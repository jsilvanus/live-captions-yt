/**
 * Tests for cardIdsForEnabledFeatures() from src/lib/workflowFeatureMap.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cardIdsForEnabledFeatures, FEATURE_TO_CARD_IDS } from '../src/lib/workflowFeatureMap.js';

describe('cardIdsForEnabledFeatures()', () => {
  it('returns an empty set for no features', () => {
    assert.deepEqual([...cardIdsForEnabledFeatures([])], []);
  });

  it('maps a single enabled feature to its card id', () => {
    const result = cardIdsForEnabledFeatures([{ code: 'stt-server', enabled: true }]);
    assert.deepEqual([...result], ['stt']);
  });

  it('ignores disabled features', () => {
    const result = cardIdsForEnabledFeatures([{ code: 'stt-server', enabled: false }]);
    assert.deepEqual([...result], []);
  });

  it('ignores feature codes with no card mapping', () => {
    const result = cardIdsForEnabledFeatures([{ code: 'mic-lock', enabled: true }, { code: 'stats', enabled: true }]);
    assert.deepEqual([...result], []);
  });

  it('expands a one-to-many feature (device-control) to all its card ids', () => {
    const result = cardIdsForEnabledFeatures([{ code: 'device-control', enabled: true }]);
    assert.deepEqual([...result].sort(), ['bridges', 'cameras', 'encoders', 'mixers']);
  });

  it('de-duplicates card ids reached by multiple features (caption-targets)', () => {
    const result = cardIdsForEnabledFeatures([
      { code: 'captions', enabled: true },
      { code: 'viewer-target', enabled: true },
      { code: 'restream-fanout', enabled: true },
    ]);
    assert.deepEqual([...result], ['caption-targets']);
  });

  it('every mapped card id list is non-empty (sanity check on the table itself)', () => {
    for (const [code, ids] of Object.entries(FEATURE_TO_CARD_IDS)) {
      assert.ok(Array.isArray(ids) && ids.length > 0, `${code} should map to at least one card id`);
    }
  });
});
