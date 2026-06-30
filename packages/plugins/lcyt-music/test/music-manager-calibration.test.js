/**
 * MusicManager Phase 4 tests — auto-calibration phase.
 *
 * Mirrors test/music-manager.test.js's mock.module() setup for
 * pcm-extractor.js (extractPcm/probeFfmpegVersion), but uses a configurable
 * mock DB row so getMusicConfig() can return auto_calibrate=1.
 */
import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const SAMPLE_RATE = 22050;
const CALIBRATION_SECONDS = 5;
const CALIBRATION_SAMPLE_THRESHOLD = SAMPLE_RATE * CALIBRATION_SECONDS;
const CALIBRATION_MIN_THRESHOLD = 0.002;
const CALIBRATION_MAX_THRESHOLD = 0.05;

function makeQuietNoise(length, amplitude = 0.01, seed = 1) {
  let s = seed;
  const pcm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    s = (s * 9301 + 49297) % 233280;
    pcm[i] = ((s / 233280) * 2 - 1) * amplitude;
  }
  return pcm;
}

function makeTone(freq, sampleRate, length) {
  const pcm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    pcm[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return pcm;
}

/** Mock DB whose getMusicConfig() row can opt into auto_calibrate. */
function makeMockDb({ autoCalibrate = false } = {}) {
  return {
    prepare() {
      return {
        get() {
          return {
            silence_threshold: 0.01,
            flatness_threshold: 0.4,
            zcr_threshold: 0.15,
            confirm_segments: 2,
            bpm_enabled: 1,
            bpm_min: 40,
            bpm_max: 200,
            auto_start: 0,
            auto_calibrate: autoCalibrate ? 1 : 0,
          };
        },
        run() { return {}; },
        all() { return []; },
      };
    },
    exec() {},
  };
}

function makeSoundProcessor() {
  const calls = [];
  const fn = (apiKey, text) => { calls.push({ apiKey, text }); return ''; };
  fn.calls = calls;
  return fn;
}

describe('MusicManager auto-calibration (Phase 4)', () => {
  let MusicManager;
  let pcmQueue;
  let originalFetch;

  before(async () => {
    mock.module('../src/pcm-extractor.js', {
      namedExports: {
        extractPcm: async () => (pcmQueue.length > 0 ? pcmQueue.shift() : new Float32Array(0)),
        probeFfmpegVersion: async () => null,
      },
    });
    ({ MusicManager } = await import('../src/music-manager.js'));
  });

  beforeEach(() => {
    pcmQueue = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('status.calibrating is false at start when autoCalibrate is off (default)', async () => {
    const mgr = new MusicManager(makeMockDb({ autoCalibrate: false }), null, makeSoundProcessor());
    await mgr.start('key1');
    assert.equal(mgr.getStatus('key1').calibrating, false);
    await mgr.stop('key1');
  });

  test('status.calibrating is true at start when autoCalibrate is on', async () => {
    const mgr = new MusicManager(makeMockDb({ autoCalibrate: true }), null, makeSoundProcessor());
    await mgr.start('key1');
    assert.equal(mgr.getStatus('key1').calibrating, true);
    await mgr.stop('key1');
  });

  test('classification is skipped while calibrating', async () => {
    const soundProcessor = makeSoundProcessor();
    const mgr = new MusicManager(makeMockDb({ autoCalibrate: true }), null, soundProcessor);
    await mgr.start('key1');

    // Push a loud tone during the calibration window — if classification ran,
    // this would trigger a label_change after a couple of segments.
    pcmQueue.push(makeTone(220, SAMPLE_RATE, 4096));
    await mgr._processSegment('key1', Buffer.from('seg'));
    pcmQueue.push(makeTone(220, SAMPLE_RATE, 4096));
    await mgr._processSegment('key1', Buffer.from('seg'));

    assert.equal(soundProcessor.calls.length, 0, 'no metacode should be synthesised while calibrating');
    assert.equal(mgr.getStatus('key1').label, null);

    await mgr.stop('key1');
  });

  test('emits "calibrated" once enough samples have been observed, then ends calibration', async () => {
    const mgr = new MusicManager(makeMockDb({ autoCalibrate: true }), null, makeSoundProcessor());
    const calibratedEvents = [];
    mgr.on('calibrated', (e) => calibratedEvents.push(e));
    await mgr.start('key1');

    pcmQueue.push(makeQuietNoise(CALIBRATION_SAMPLE_THRESHOLD, 0.01));
    await mgr._processSegment('key1', Buffer.from('seg'));

    assert.equal(calibratedEvents.length, 1, 'calibrated should fire exactly once');
    assert.equal(calibratedEvents[0].apiKey, 'key1');
    assert.ok(calibratedEvents[0].silenceThreshold >= CALIBRATION_MIN_THRESHOLD);
    assert.ok(calibratedEvents[0].silenceThreshold <= CALIBRATION_MAX_THRESHOLD);
    assert.ok(typeof calibratedEvents[0].ts === 'number');

    const status = mgr.getStatus('key1');
    assert.equal(status.calibrating, false);
    assert.equal(status.calibratedSilenceThreshold, calibratedEvents[0].silenceThreshold);

    await mgr.stop('key1');
  });

  test('accumulates across multiple segments before crossing the calibration threshold', async () => {
    const mgr = new MusicManager(makeMockDb({ autoCalibrate: true }), null, makeSoundProcessor());
    const calibratedEvents = [];
    mgr.on('calibrated', (e) => calibratedEvents.push(e));
    await mgr.start('key1');

    const half = Math.floor(CALIBRATION_SAMPLE_THRESHOLD / 2);
    pcmQueue.push(makeQuietNoise(half, 0.01, 3));
    await mgr._processSegment('key1', Buffer.from('seg'));
    assert.equal(mgr.getStatus('key1').calibrating, true, 'half the window should not be enough yet');
    assert.equal(calibratedEvents.length, 0);

    pcmQueue.push(makeQuietNoise(CALIBRATION_SAMPLE_THRESHOLD - half + 100, 0.01, 5));
    await mgr._processSegment('key1', Buffer.from('seg'));
    assert.equal(mgr.getStatus('key1').calibrating, false);
    assert.equal(calibratedEvents.length, 1);

    await mgr.stop('key1');
  });

  test('classification resumes using the calibrated threshold after calibration ends', async () => {
    const soundProcessor = makeSoundProcessor();
    const labelEvents = [];
    const mgr = new MusicManager(makeMockDb({ autoCalibrate: true }), null, soundProcessor);
    mgr.on('label_change', (e) => labelEvents.push(e));
    await mgr.start('key1');

    pcmQueue.push(makeQuietNoise(CALIBRATION_SAMPLE_THRESHOLD, 0.01));
    await mgr._processSegment('key1', Buffer.from('seg'));
    assert.equal(mgr.getStatus('key1').calibrating, false);

    // confirmSegments defaults to 2 — two sustained tone segments after
    // calibration should produce exactly one label_change to "music".
    pcmQueue.push(makeTone(220, SAMPLE_RATE, 8192));
    await mgr._processSegment('key1', Buffer.from('seg'));
    pcmQueue.push(makeTone(220, SAMPLE_RATE, 8192));
    await mgr._processSegment('key1', Buffer.from('seg'));

    assert.equal(labelEvents.length, 1);
    assert.equal(labelEvents[0].label, 'music');

    await mgr.stop('key1');
  });
});
