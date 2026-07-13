/**
 * Tests for the pure per-viewport renderer helpers
 * (plan_dsk_viewport_settings Phase 4 renderer increment).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  viewportPageUrl,
  resolveCaptureDimensions,
  resolveCaptureBackground,
  buildViewportOutputs,
} from '../src/renderer-helpers.js';

describe('viewportPageUrl', () => {
  test('prefers slug, falls back to api key, encodes segments', () => {
    assert.equal(
      viewportPageUrl({ slug: 'sunday', apiKey: 'k', viewport: 'vertical-left', baseUrl: 'http://x' }),
      'http://x/dsk/sunday/vertical-left');
    assert.equal(
      viewportPageUrl({ slug: null, apiKey: 'raw-key', viewport: 'v', baseUrl: 'http://x/' }),
      'http://x/dsk/raw-key/v');
  });
});

describe('resolveCaptureDimensions', () => {
  test('uses viewport dims, defaults to 1920x1080', () => {
    assert.deepEqual(resolveCaptureDimensions({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
    assert.deepEqual(resolveCaptureDimensions(null), { width: 1920, height: 1080 });
    assert.deepEqual(resolveCaptureDimensions({ width: 0, height: -5 }), { width: 1920, height: 1080 });
  });
});

describe('resolveCaptureBackground', () => {
  test('passes a solid background through', () => {
    assert.deepEqual(resolveCaptureBackground({ background: '#123456' }), { background: '#123456', warnTransparent: false });
  });
  test('transparent + chromaKey enabled → render against the key color', () => {
    assert.deepEqual(
      resolveCaptureBackground({ background: 'transparent', stream: { chromaKey: { enabled: true, color: '#00B140' } } }),
      { background: '#00B140', warnTransparent: false });
  });
  test('transparent without keying → black + warning (alpha does not survive h264)', () => {
    assert.deepEqual(resolveCaptureBackground({ background: 'transparent' }), { background: '#000000', warnTransparent: true });
  });
  test('defaults to chroma green when unset', () => {
    assert.equal(resolveCaptureBackground(null).background, '#00B140');
  });
});

describe('buildViewportOutputs', () => {
  test('single local leg → no tee', () => {
    const out = buildViewportOutputs({ apiKey: 'k', viewport: 'v', rtmpBase: 'rtmp://h:1935' });
    assert.equal(out.localUrl, 'rtmp://h:1935/dsk/k__v');
    assert.deepEqual(out.targets, ['rtmp://h:1935/dsk/k__v']);
    assert.equal(out.teeString, null);
  });

  test('local + enabled push targets → tee string, disabled/non-rtmp dropped', () => {
    const out = buildViewportOutputs({
      apiKey: 'k', viewport: 'vert', rtmpBase: 'rtmp://h:1935/',
      pushUrls: [
        { url: 'rtmp://tiktok/live/KEY', enabled: true },
        { url: 'https://nope', enabled: true },       // non-rtmp → dropped
        { url: 'rtmp://disabled/x', enabled: false },   // disabled → dropped
      ],
    });
    assert.equal(out.localUrl, 'rtmp://h:1935/dsk/k__vert');
    assert.deepEqual(out.targets, ['rtmp://h:1935/dsk/k__vert', 'rtmp://tiktok/live/KEY']);
    assert.equal(out.teeString, '[f=flv]rtmp://h:1935/dsk/k__vert|[f=flv]rtmp://tiktok/live/KEY');
  });
});
