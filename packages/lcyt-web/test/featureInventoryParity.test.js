/**
 * Guards against drift between the setup wizard's feature inventory and the
 * backend's (packages/lcyt-backend/src/db/project-features.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_FEATURE_CODES, WEB_ONLY_FEATURE_CODES, DEPS, FEATURE_LABELS } from '../src/components/setup-wizard/lib/constants.js';
import { KNOWN_FEATURE_CODES, FEATURE_DEPS } from '../../lcyt-backend/src/db/project-features.js';

describe('wizard feature inventory vs backend', () => {
  it('every backend feature code is in ALL_FEATURE_CODES', () => {
    const missing = [...KNOWN_FEATURE_CODES].filter(c => !ALL_FEATURE_CODES.includes(c));
    assert.deepEqual(missing, []);
  });

  it('ALL_FEATURE_CODES only has backend codes plus the declared web-only ones', () => {
    const extra = ALL_FEATURE_CODES.filter(c => !KNOWN_FEATURE_CODES.has(c) && !WEB_ONLY_FEATURE_CODES.includes(c));
    assert.deepEqual(extra, []);
  });

  it('every code has a label', () => {
    assert.deepEqual(ALL_FEATURE_CODES.filter(c => !FEATURE_LABELS[c]), []);
  });

  it('DEPS equals the backend FEATURE_DEPS', () => {
    assert.deepEqual(DEPS, FEATURE_DEPS);
  });
});
