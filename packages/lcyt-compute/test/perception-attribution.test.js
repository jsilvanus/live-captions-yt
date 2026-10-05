import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FP_WIDTH, FP_HEIGHT, fingerprintFromRgb, similarity, frameDiff, matchFingerprint, createAttributionState,
} from '../src/perception/attribution.js';

/** Synthetic shot: a bright block at (bx,by) on a dark gradient. */
function shot(bx, by, { gain = 1, bg = 40 } = {}) {
  const buf = Buffer.alloc(FP_WIDTH * FP_HEIGHT * 3);
  for (let y = 0; y < FP_HEIGHT; y++) {
    for (let x = 0; x < FP_WIDTH; x++) {
      const inBlock = Math.abs(x - bx) <= 2 && Math.abs(y - by) <= 1;
      const v = Math.min(255, Math.round((inBlock ? 220 : bg + x * 2) * gain));
      const o = (y * FP_WIDTH + x) * 3;
      buf[o] = v; buf[o + 1] = inBlock ? v : Math.round(v * 0.8); buf[o + 2] = Math.round(v * 0.6);
    }
  }
  return fingerprintFromRgb(buf);
}

const refs = [
  { cameraId: 'altar', presetId: 'p1', fp: shot(3, 4) },
  { cameraId: 'choir', presetId: null, fp: shot(12, 4) },
  { cameraId: 'pulpit', presetId: null, fp: shot(8, 1) },
];

describe('fingerprint matching', () => {
  test('identical shot matches its own camera with high confidence', () => {
    const m = matchFingerprint(shot(3, 4), refs);
    assert.equal(m.cameraId, 'altar');
    assert.equal(m.presetId, 'p1');
    assert.ok(m.confidence > 0.7, `confidence ${m.confidence}`);
  });

  test('exposure change does not break the match', () => {
    assert.equal(matchFingerprint(shot(12, 4, { gain: 0.6 }), refs)?.cameraId, 'choir');
  });

  test('a shot like none of the references is no match, not a guess', () => {
    const unrelated = shot(15, 8, { bg: 200 });
    assert.equal(matchFingerprint(unrelated, refs), null);
  });

  test('two near-identical references make the match ambiguous', () => {
    const dup = [
      { cameraId: 'a', fp: shot(5, 4) },
      { cameraId: 'b', fp: shot(5, 4) },
    ];
    assert.equal(matchFingerprint(shot(5, 4), dup), null);
  });

  test('single reference needs a stricter similarity', () => {
    const one = [{ cameraId: 'a', fp: shot(3, 4) }];
    assert.equal(matchFingerprint(shot(3, 4), one)?.cameraId, 'a');
    assert.equal(matchFingerprint(shot(10, 6), one), null);
  });

  test('no references -> null; frameDiff and similarity basics', () => {
    assert.equal(matchFingerprint(shot(3, 4), []), null);
    assert.ok(frameDiff(shot(3, 4), shot(3, 4)) === 0);
    assert.ok(frameDiff(shot(3, 4), shot(12, 4)) > 0.05);
    assert.ok(similarity(shot(3, 4), shot(3, 4)) > 0.99);
  });

  test('rejects wrong-sized input', () => {
    assert.throws(() => fingerprintFromRgb(Buffer.alloc(10)));
  });
});

describe('attribution hysteresis', () => {
  const m = (cameraId, confidence = 0.8) => ({ cameraId, presetId: null, confidence });

  test('a held shot does not flicker and the first switch needs two frames', () => {
    const s = createAttributionState();
    assert.equal(s.update(m('altar')).changed, false);
    const r = s.update(m('altar'));
    assert.equal(r.changed, true);
    assert.equal(r.cameraId, 'altar');
    assert.equal(s.update(m('altar')).changed, false);
  });

  test('one odd frame does not switch the source', () => {
    const s = createAttributionState();
    s.update(m('altar')); s.update(m('altar'));
    assert.equal(s.update(m('choir')).changed, false);
    assert.equal(s.update(m('altar')).changed, false);
    assert.equal(s.current.cameraId, 'altar');
  });

  test('a scene cut makes the switch immediate', () => {
    const s = createAttributionState();
    s.update(m('altar')); s.update(m('altar'));
    const r = s.update(m('choir'), { cut: true });
    assert.equal(r.changed, true);
    assert.equal(r.cameraId, 'choir');
  });

  test('unclear frames fall back to unknown after a few frames', () => {
    const s = createAttributionState();
    s.update(m('altar')); s.update(m('altar'));
    assert.equal(s.update(null).changed, false);
    assert.equal(s.update(null).changed, false);
    const r = s.update(null);
    assert.equal(r.changed, true);
    assert.equal(r.cameraId, null);
  });

  test('same camera, different preset is reported', () => {
    const s = createAttributionState();
    s.update({ cameraId: 'a', presetId: 'p1', confidence: 0.8 });
    s.update({ cameraId: 'a', presetId: 'p1', confidence: 0.8 });
    assert.equal(s.update({ cameraId: 'a', presetId: 'p2', confidence: 0.8 }).changed, true);
  });
});
