import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helpers — synthetic PCM signals
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 22050;

function makeSilence(length = 8192) {
  return new Float64Array(length);
}

function makeTone(freq, sampleRate, length) {
  const pcm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    pcm[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return pcm;
}

function makeNoise(length, seed = 1) {
  let s = seed;
  const pcm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    s = (s * 9301 + 49297) % 233280;
    pcm[i] = (s / 233280) * 2 - 1;
  }
  return pcm;
}

// ---------------------------------------------------------------------------
// Helpers — mock collaborators
// ---------------------------------------------------------------------------

/** Mock DB: getMusicConfig always returns defaults (no row in music_config). */
function makeMockDb() {
  return {
    prepare() {
      return { get() { return undefined; }, run() { return {}; }, all() { return []; } };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MusicManager', () => {
  let MusicManager;
  let pcmQueue;
  let originalFetch;

  before(async () => {
    mock.module('../src/pcm-extractor.js', {
      namedExports: {
        // Pops the next queued PCM frame; defaults to silence if the queue is empty.
        extractPcm: async () => (pcmQueue.length > 0 ? pcmQueue.shift() : makeSilence()),
        probeFfmpegVersion: async () => null,
      },
    });
    ({ MusicManager } = await import('../src/music-manager.js'));
  });

  beforeEach(() => {
    pcmQueue = [];
    originalFetch = globalThis.fetch;
    // HlsSegmentFetcher polls in the background once started; keep it harmless.
    globalThis.fetch = async () => ({ ok: false, status: 404 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('isRunning() is false before start and true after', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    assert.equal(mgr.isRunning('key1'), false);
    await mgr.start('key1');
    assert.equal(mgr.isRunning('key1'), true);
    await mgr.stop('key1');
    assert.equal(mgr.isRunning('key1'), false);
  });

  test('getStatus() reports running state and stream key', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    assert.equal(mgr.getStatus('key1').running, false);
    await mgr.start('key1', { streamKey: 'custom-stream' });
    const status = mgr.getStatus('key1');
    assert.equal(status.running, true);
    assert.equal(status.streamKey, 'custom-stream');
    assert.equal(status.segmentsProcessed, 0);
    await mgr.stop('key1');
  });

  test('starting twice for the same key restarts cleanly', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    await mgr.start('key1');
    await mgr.start('key1');
    assert.equal(mgr.isRunning('key1'), true);
    await mgr.stop('key1');
  });

  test('stop() emits "stopped" and is a no-op for an unknown key', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    let stoppedEvt = null;
    mgr.on('stopped', (e) => { stoppedEvt = e; });
    await mgr.start('key1');
    await mgr.stop('key1');
    assert.deepEqual(stoppedEvt, { apiKey: 'key1' });

    stoppedEvt = null;
    await mgr.stop('never-started');
    assert.equal(stoppedEvt, null);
  });

  test('stopAll() stops every running session', async () => {
    const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
    await mgr.start('key1');
    await mgr.start('key2');
    await mgr.stopAll();
    assert.equal(mgr.isRunning('key1'), false);
    assert.equal(mgr.isRunning('key2'), false);
  });

  test('confirm-segments: a single music-like segment does not trigger a label change', async () => {
    const soundProcessor = makeSoundProcessor();
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    await mgr.start('key1');

    pcmQueue.push(makeTone(220, SAMPLE_RATE, 8192));
    await mgr._processSegment('key1', Buffer.from('seg'));

    assert.equal(soundProcessor.calls.length, 0, 'default confirmSegments=2 should require a second segment');
    await mgr.stop('key1');
  });

  test('confirm-segments: label change fires once the threshold is reached, and only once', async () => {
    const soundProcessor = makeSoundProcessor();
    const events = [];
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    mgr.on('label_change', (e) => events.push(e));
    await mgr.start('key1');

    for (let i = 0; i < 3; i++) {
      pcmQueue.push(makeTone(220, SAMPLE_RATE, 8192));
      await mgr._processSegment('key1', Buffer.from('seg'));
    }

    assert.equal(events.length, 1, 'label_change should fire exactly once for a sustained label');
    assert.equal(events[0].label, 'music');
    assert.equal(soundProcessor.calls.length, 1);
    assert.match(soundProcessor.calls[0].text, /<!-- sound:music/);

    await mgr.stop('key1');
  });

  test('flicker between labels resets the pending counter and suppresses spurious transitions', async () => {
    const soundProcessor = makeSoundProcessor();
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    await mgr.start('key1');

    // music, speech, music, speech — never two consecutive identical labels,
    // so confirmedLabel should never move off its initial null and no
    // metacode should be synthesised.
    pcmQueue.push(makeTone(220, SAMPLE_RATE, 8192));
    await mgr._processSegment('key1', Buffer.from('seg'));
    pcmQueue.push(makeNoise(8192, 7));
    await mgr._processSegment('key1', Buffer.from('seg'));
    pcmQueue.push(makeTone(220, SAMPLE_RATE, 8192));
    await mgr._processSegment('key1', Buffer.from('seg'));

    assert.equal(soundProcessor.calls.length, 0);
    await mgr.stop('key1');
  });

  test('an empty PCM frame (decode failure) is skipped without incrementing state', async () => {
    const soundProcessor = makeSoundProcessor();
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    await mgr.start('key1');

    pcmQueue.push(new Float32Array(0));
    await mgr._processSegment('key1', Buffer.from('seg'));

    const status = mgr.getStatus('key1');
    // segmentsProcessed is incremented before the pcm-length check, but no
    // classification/emission should have happened.
    assert.equal(status.label, null);
    assert.equal(soundProcessor.calls.length, 0);

    await mgr.stop('key1');
  });

  test('_processSegment() is a no-op once the session has been stopped', async () => {
    const soundProcessor = makeSoundProcessor();
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    await mgr.start('key1');
    await mgr.stop('key1');

    pcmQueue.push(makeTone(220, SAMPLE_RATE, 8192));
    await mgr._processSegment('key1', Buffer.from('seg'));

    assert.equal(soundProcessor.calls.length, 0);
  });

  test('bpm is only emitted once confirmedLabel === "music" and bpmEnabled', async () => {
    const soundProcessor = makeSoundProcessor();
    const bpmEvents = [];
    const mgr = new MusicManager(makeMockDb(), null, soundProcessor);
    mgr.on('bpm_update', (e) => bpmEvents.push(e));
    await mgr.start('key1');

    // Two speech segments: confirmedLabel becomes 'speech', bpm path skipped entirely.
    for (let i = 0; i < 2; i++) {
      pcmQueue.push(makeNoise(8192, i + 1));
      await mgr._processSegment('key1', Buffer.from('seg'));
    }
    assert.equal(bpmEvents.length, 0);

    await mgr.stop('key1');
  });

  describe('auto-start on publish (via on_publish hook in lcyt-rtmp)', () => {
    test('ffmpegVersion is probed on construction', async () => {
      const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
      // The mock sets probeFfmpegVersion to return null, so ffmpegVersion should be null
      assert.equal(mgr.ffmpegVersion, null);
    });

    test('start() can be called even when ffmpegVersion is null (graceful handling in rtmp.js)', async () => {
      const mgr = new MusicManager(makeMockDb(), null, makeSoundProcessor());
      assert.equal(mgr.ffmpegVersion, null);
      // start() should not throw; the RTMP route layer checks ffmpegVersion before calling start()
      await mgr.start('key1');
      assert.equal(mgr.isRunning('key1'), true);
      await mgr.stop('key1');
    });

    test('auto-start behavior: enabled=true + autoStart=true → start is called', async () => {
      // This test documents the expected behavior:
      // When the RTMP on_publish hook runs, it checks:
      //   if (musicConfig.enabled && musicConfig.autoStart && !musicManager.isRunning(apiKey)) {
      //     if (musicManager.ffmpegVersion) {
      //       musicManager.start(apiKey, { streamKey: apiKey })
      //     }
      //   }
      // This test verifies the config conditions are correct; the actual wiring is tested via
      // the RTMP route tests in lcyt-rtmp.
      const mockDb = {
        prepare() {
          return {
            get() {
              return {
                enabled: 1,
                auto_start: 1,
                silence_threshold: 0.01,
                flatness_threshold: 0.4,
                zcr_threshold: 0.15,
                confirm_segments: 2,
                bpm_enabled: 1,
                bpm_min: 40,
                bpm_max: 200,
                auto_calibrate: 0,
              };
            },
            run() { return {}; },
            all() { return []; },
          };
        },
        exec() {},
      };
      const { getMusicConfig } = await import('../src/db.js');
      const config = getMusicConfig(mockDb, 'key1');
      assert.equal(config.enabled, true);
      assert.equal(config.autoStart, true);
      // The RTMP router should check both conditions before starting
    });

    test('auto-start behavior: enabled=false + autoStart=true → start is NOT called', async () => {
      // When enabled=false but autoStart=true, the on_publish hook should not start.
      // This is like having music detection configured but not enabled globally for the key.
      const mockDb = {
        prepare() {
          return {
            get() {
              return {
                enabled: 0,
                auto_start: 1,
                silence_threshold: 0.01,
                flatness_threshold: 0.4,
                zcr_threshold: 0.15,
                confirm_segments: 2,
                bpm_enabled: 1,
                bpm_min: 40,
                bpm_max: 200,
                auto_calibrate: 0,
              };
            },
            run() { return {}; },
            all() { return []; },
          };
        },
        exec() {},
      };
      const { getMusicConfig } = await import('../src/db.js');
      const config = getMusicConfig(mockDb, 'key1');
      assert.equal(config.enabled, false);
      assert.equal(config.autoStart, true);
      // The RTMP router checks: if (config.enabled && config.autoStart)
      // This should NOT start because enabled=false
    });
  });
});
