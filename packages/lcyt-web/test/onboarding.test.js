/**
 * Unit tests for src/lib/onboarding.js — pure functions, no React/DOM.
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isOnboarded, markOnboarded } from '../src/lib/onboarding.js';

const _store = {};
const _ls = {
  getItem: (k) => _store[k] ?? null,
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};

before(() => {
  globalThis.localStorage = _ls;
});

beforeEach(() => {
  for (const k of Object.keys(_store)) delete _store[k];
});

describe('isOnboarded()', () => {
  it('returns true (do not nag) when apiKey is missing', () => {
    assert.equal(isOnboarded(''), true);
    assert.equal(isOnboarded(undefined), true);
  });

  it('returns false for a project never marked onboarded', () => {
    assert.equal(isOnboarded('proj-1'), false);
  });

  it('returns true after markOnboarded() for that project', () => {
    markOnboarded('proj-1');
    assert.equal(isOnboarded('proj-1'), true);
  });

  it('is scoped per project — marking one does not mark another', () => {
    markOnboarded('proj-1');
    assert.equal(isOnboarded('proj-2'), false);
  });
});

describe('markOnboarded()', () => {
  it('is a no-op when apiKey is missing', () => {
    markOnboarded('');
    assert.deepEqual(Object.keys(_store), []);
  });
});
