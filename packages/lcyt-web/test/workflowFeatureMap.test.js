/**
 * Tests for cardIdsForEnabledFeatures() from src/lib/workflowFeatureMap.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cardReasons, cardIdsForEnabledFeatures, FEATURE_TO_CARD_IDS } from '../src/lib/workflowFeatureMap.js';

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

  it('expands a one-to-many feature (device-control) to the Devices card and Bridges', () => {
    const result = cardIdsForEnabledFeatures([{ code: 'device-control', enabled: true }]);
    assert.deepEqual([...result].sort(), ['bridges', 'devices']);
  });

  it('de-duplicates card ids reached by multiple features (caption-targets)', () => {
    const result = cardIdsForEnabledFeatures([
      { code: 'captions', enabled: true },
      { code: 'viewer-target', enabled: true },
      { code: 'cea-captions', enabled: true },
    ]);
    assert.deepEqual([...result], ['caption-targets']);
  });

  it('maps ingest to both the egress and feeds cards, restream to egress', () => {
    assert.deepEqual([...cardIdsForEnabledFeatures([{ code: 'ingest', enabled: true }])].sort(), ['egress', 'feeds']);
    assert.deepEqual([...cardIdsForEnabledFeatures([{ code: 'restream', enabled: true }])], ['egress']);
  });

  it('every mapped card id list is non-empty (sanity check on the table itself)', () => {
    for (const [code, ids] of Object.entries(FEATURE_TO_CARD_IDS)) {
      assert.ok(Array.isArray(ids) && ids.length > 0, `${code} should map to at least one card id`);
    }
  });
});

describe('FEATURE_TO_CARD_IDS card ids', () => {
  it('every mapped card id is a real Setup Hub card (id="..." in setup-hub/*.jsx)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../src/components/setup-hub/', import.meta.url);
    const src = readdirSync(dir).filter(f => f.endsWith('.jsx')).map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
    const unknown = new Set();
    for (const ids of Object.values(FEATURE_TO_CARD_IDS)) {
      for (const id of ids) if (!src.includes(`id="${id}"`)) unknown.add(id);
    }
    assert.deepEqual([...unknown], []);
  });
});

describe('cardReasons()', () => {
  it('lists every enabled feature that brings a card in', () => {
    const r = cardReasons([{ code: 'captions', enabled: true }, { code: 'cea-captions', enabled: true }, { code: 'stt-server', enabled: false }]);
    assert.deepEqual(r.get('caption-targets'), ['captions', 'cea-captions']);
    assert.equal(r.has('stt'), false);
  });
});
