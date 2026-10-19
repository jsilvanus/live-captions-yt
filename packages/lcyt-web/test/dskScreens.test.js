import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  screenKey, normaliseBg, loadScreenMappings, saveScreenMappings,
  mappingFor, withMapping, displayUrl, SCREEN_MAPPINGS_KEY,
} from '../src/lib/dskScreens.js';

const screen = { label: 'DELL U2720Q', left: 1920, top: 0, width: 2560, height: 1440 };

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

describe('screenKey()', () => {
  it('combines label, size and position', () => {
    assert.equal(screenKey(screen), 'DELL U2720Q|2560x1440@1920,0');
  });
  it('falls back when the label is missing', () => {
    assert.equal(screenKey({ width: 1920, height: 1080, left: 0, top: 0 }), 'screen|1920x1080@0,0');
  });
});

describe('normaliseBg()', () => {
  it('accepts transparent and hex colours, uppercased', () => {
    assert.equal(normaliseBg('transparent'), 'transparent');
    assert.equal(normaliseBg('#00b140'), '#00B140');
  });
  it('falls back to transparent for anything else', () => {
    assert.equal(normaliseBg('red'), 'transparent');
    assert.equal(normaliseBg(undefined), 'transparent');
  });
});

describe('localStorage mappings', () => {
  it('reads an empty map when nothing is stored or the JSON is broken', () => {
    assert.deepEqual(loadScreenMappings(memoryStorage()), {});
    assert.deepEqual(loadScreenMappings(memoryStorage({ [SCREEN_MAPPINGS_KEY]: '{bad' })), {});
    assert.deepEqual(loadScreenMappings(memoryStorage({ [SCREEN_MAPPINGS_KEY]: '[1]' })), {});
  });
  it('returns false instead of throwing when storage is blocked', () => {
    const blocked = { setItem() { throw new Error('QuotaExceededError'); } };
    assert.equal(saveScreenMappings(blocked, { a: {} }), false);
    assert.equal(saveScreenMappings(undefined, {}), true);
  });
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const m = withMapping({}, screen, { viewport: 'landscape', bg: '#00B140' });
    assert.equal(saveScreenMappings(storage, m), true);
    assert.deepEqual(mappingFor(loadScreenMappings(storage), screen), { viewport: 'landscape', bg: '#00B140' });
  });
});

describe('mappingFor() / withMapping()', () => {
  it('defaults to no viewport and a transparent background', () => {
    assert.deepEqual(mappingFor({}, screen), { viewport: '', bg: 'transparent' });
  });
  it('patches one field and keeps the others', () => {
    const m1 = withMapping({}, screen, { viewport: 'vertical-left' });
    const m2 = withMapping(m1, screen, { bg: '#112233' });
    assert.deepEqual(mappingFor(m2, screen), { viewport: 'vertical-left', bg: '#112233' });
  });
  it('does not change other screens', () => {
    const other = { label: 'LG', left: 0, top: 0, width: 1920, height: 1080 };
    const m = withMapping({}, screen, { viewport: 'a' });
    assert.deepEqual(mappingFor(m, other), { viewport: '', bg: 'transparent' });
  });
});

describe('displayUrl()', () => {
  const origin = 'https://lcyt.example';
  it('uses the slug form for a named viewport', () => {
    const url = new URL(displayUrl({ origin, projectSlug: 'messu', apiKey: 'K', viewport: 'vertical-left', bg: 'transparent' }));
    assert.equal(url.pathname, '/dsk/messu/vertical-left');
    assert.equal(url.searchParams.get('bg'), 'transparent');
  });
  it('uses the slug alone for the landscape page', () => {
    assert.equal(displayUrl({ origin, projectSlug: 'messu', apiKey: 'K', viewport: '' }), 'https://lcyt.example/dsk/messu');
  });
  it('falls back to the key form with ?viewport= when there is no slug', () => {
    const url = new URL(displayUrl({ origin, projectSlug: null, apiKey: 'K1', viewport: 'lower', bg: '#00B140' }));
    assert.equal(url.pathname, '/dsk/K1');
    assert.equal(url.searchParams.get('viewport'), 'lower');
    assert.equal(url.searchParams.get('bg'), '#00B140');
  });
});
