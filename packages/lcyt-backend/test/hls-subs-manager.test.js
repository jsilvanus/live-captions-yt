import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import { formatVttTime, buildWebVTT, buildPlaylist, HlsSubsManager } from 'lcyt-rtmp/src/hls-subs-manager.js';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('formatVttTime', () => {
  test('zero', () => assert.equal(formatVttTime(0), '00:00:00.000'));
  test('sub-second', () => assert.equal(formatVttTime(500), '00:00:00.500'));
  test('seconds', () => assert.equal(formatVttTime(3500), '00:00:03.500'));
  test('minutes', () => assert.equal(formatVttTime(90_000), '00:01:30.000'));
  test('hours', () => assert.equal(formatVttTime(3_661_001), '01:01:01.001'));
});

describe('buildWebVTT', () => {
  const SEG_START = 1_000_000_000_000; // arbitrary epoch ms
  const SEG_DUR   = 6_000;

  test('empty cues returns bare WEBVTT', () => {
    const vtt = buildWebVTT([], SEG_START, SEG_DUR);
    assert.equal(vtt, 'WEBVTT\n');
  });

  test('single cue with default end (3.5 s, capped at seg end)', () => {
    const cues = [{ text: 'Hello', tsMs: SEG_START + 1000 }];
    const vtt = buildWebVTT(cues, SEG_START, SEG_DUR);
    assert.ok(vtt.startsWith('WEBVTT\n\n'), 'starts with WEBVTT header');
    assert.ok(vtt.includes('00:00:01.000 --> 00:00:04.500'), 'start and end times correct');
    assert.ok(vtt.includes('Hello'), 'cue text present');
  });

  test('single cue end capped at segment boundary', () => {
    const cues = [{ text: 'Late', tsMs: SEG_START + 4000 }];
    const vtt = buildWebVTT(cues, SEG_START, SEG_DUR);
    // start=4000ms, end would be 7500ms but segment is only 6000ms → capped at 6000
    assert.ok(vtt.includes('00:00:04.000 --> 00:00:06.000'), 'end capped at segment boundary');
  });

  test('two cues: first ends at second start minus gap', () => {
    const cues = [
      { text: 'First',  tsMs: SEG_START + 1000 },
      { text: 'Second', tsMs: SEG_START + 3000 },
    ];
    const vtt = buildWebVTT(cues, SEG_START, SEG_DUR);
    // first end = 3000 - 50 = 2950
    assert.ok(vtt.includes('00:00:01.000 --> 00:00:02.950'), 'first cue end from next start');
    assert.ok(vtt.includes('00:00:03.000 --> 00:00:06.000'), 'second cue end at seg boundary');
  });

  test('cue starting at or after segment end is skipped', () => {
    const cues = [{ text: 'Too late', tsMs: SEG_START + 6001 }];
    const vtt = buildWebVTT(cues, SEG_START, SEG_DUR);
    assert.equal(vtt, 'WEBVTT\n', 'out-of-window cue produces empty segment');
  });

  test('negative offset cue clamped to 0', () => {
    const cues = [{ text: 'Early', tsMs: SEG_START - 500 }];
    const vtt = buildWebVTT(cues, SEG_START, SEG_DUR);
    assert.ok(vtt.includes('00:00:00.000 -->'), 'negative start clamped to 0');
  });
});

describe('buildPlaylist', () => {
  const SEG_DUR_MS = 6_000;

  test('single segment playlist', () => {
    const langState = {
      sequence: 0,
      segments: [{ filename: 'seg000000.vtt', startMs: new Date('2026-03-14T12:00:00.000Z').getTime() }],
    };
    const m3u8 = buildPlaylist(langState, SEG_DUR_MS);
    assert.ok(m3u8.startsWith('#EXTM3U\n'), 'starts with EXTM3U');
    assert.ok(m3u8.includes('#EXT-X-VERSION:3'), 'version 3');
    assert.ok(m3u8.includes('#EXT-X-TARGETDURATION:7'), 'target duration = seg + 1');
    assert.ok(m3u8.includes('#EXT-X-MEDIA-SEQUENCE:0'), 'sequence 0');
    assert.ok(m3u8.includes('#EXT-X-PROGRAM-DATE-TIME:2026-03-14T12:00:00.000Z'), 'PDT header');
    assert.ok(m3u8.includes('#EXTINF:6.000,'), 'EXTINF duration');
    assert.ok(m3u8.includes('seg000000.vtt'), 'segment filename');
  });

  test('rolling window with sequence > 0', () => {
    const langState = {
      sequence: 5,
      segments: [
        { filename: 'seg000005.vtt', startMs: Date.now() },
        { filename: 'seg000006.vtt', startMs: Date.now() + 6000 },
      ],
    };
    const m3u8 = buildPlaylist(langState, SEG_DUR_MS);
    assert.ok(m3u8.includes('#EXT-X-MEDIA-SEQUENCE:5'), 'correct sequence after evictions');
    assert.ok(m3u8.includes('seg000005.vtt'), 'first segment present');
    assert.ok(m3u8.includes('seg000006.vtt'), 'second segment present');
  });
});

// ---------------------------------------------------------------------------
// HlsSubsManager integration tests (uses real tmp directory)
// ---------------------------------------------------------------------------

describe('HlsSubsManager', () => {
  const testRoot = join(tmpdir(), `lcyt-hls-subs-test-${process.pid}`);
  let mgr;

  before(() => {
    mgr = new HlsSubsManager({
      subsRoot:        testRoot,
      segmentDuration: 1,   // 1-second segments for fast tests
      windowSize:      3,
      maxIdleSegments: 5,
    });
  });

  after(async () => {
    await mgr.stopAll();
    await rm(testRoot, { recursive: true, force: true });
  });

  test('getLanguages returns [] for unknown key', () => {
    assert.deepEqual(mgr.getLanguages('unknown-key'), []);
  });

  test('getPlaylist returns null for unknown key', () => {
    assert.equal(mgr.getPlaylist('unknown-key', 'en'), null);
  });

  test('addCue starts tracking a key', () => {
    const ts = new Date().toISOString().replace('Z', '');
    mgr.addCue('testkey', 'original', 'Hello', ts);
    // State is created but no segments yet (timer not fired)
    assert.equal(mgr.getPlaylist('testkey', 'original'), null); // no segment flushed yet
  });

  test('after flush, playlist and segment file exist', async () => {
    const now = Date.now();
    const ts  = new Date(now).toISOString().replace('Z', '');
    mgr.addCue('flushtest', 'en', 'Test caption', ts);

    // Manually trigger flush
    await mgr._flush('flushtest');

    const playlist = mgr.getPlaylist('flushtest', 'en');
    assert.ok(playlist, 'playlist available after flush');
    assert.ok(playlist.includes('#EXTM3U'), 'valid m3u8');
    assert.ok(playlist.includes('seg000000.vtt'), 'segment filename in playlist');

    const segFile = join(testRoot, 'flushtest', 'en', 'seg000000.vtt');
    const content = await readFile(segFile, 'utf8');
    assert.ok(content.startsWith('WEBVTT'), 'segment file is valid WebVTT');
    assert.ok(content.includes('Test caption'), 'cue text in file');
  });

  test('multiple languages tracked independently', async () => {
    const ts = new Date().toISOString().replace('Z', '');
    mgr.addCue('multilang', 'original', 'Hello',     ts);
    mgr.addCue('multilang', 'fi-FI',   'Hei',        ts);
    mgr.addCue('multilang', 'de-DE',   'Hallo',      ts);

    await mgr._flush('multilang');

    const langs = mgr.getLanguages('multilang');
    assert.ok(langs.includes('original'), 'original tracked');
    assert.ok(langs.includes('fi-FI'), 'fi-FI tracked');
    assert.ok(langs.includes('de-DE'), 'de-DE tracked');

    const fiContent = await readFile(join(testRoot, 'multilang', 'fi-FI', 'seg000000.vtt'), 'utf8');
    assert.ok(fiContent.includes('Hei'), 'Finnish cue in fi-FI segment');
  });

  test('rolling window evicts oldest segment when full', async () => {
    const ts = new Date().toISOString().replace('Z', '');
    mgr.addCue('rollwin', 'en', 'Cue', ts);

    // Flush 4 times — windowSize is 3, so the first segment should be evicted
    for (let i = 0; i < 4; i++) {
      await mgr._flush('rollwin');
    }

    const playlist = mgr.getPlaylist('rollwin', 'en');
    const lines = playlist.split('\n');
    const segs  = lines.filter(l => l.endsWith('.vtt'));
    assert.equal(segs.length, 3, 'only 3 segments in rolling window');
    // Sequence should be 1 (one segment evicted)
    assert.ok(playlist.includes('#EXT-X-MEDIA-SEQUENCE:1'), 'sequence incremented after eviction');
  });

  test('empty segment written when no cues in window', async () => {
    // Do a flush with no pending cues for a key that has had data before
    const ts = new Date().toISOString().replace('Z', '');
    mgr.addCue('emptytest', 'en', 'Initial', ts);
    await mgr._flush('emptytest'); // flush with cues
    await mgr._flush('emptytest'); // flush with no cues

    const playlist = mgr.getPlaylist('emptytest', 'en');
    assert.ok(playlist.includes('seg000001.vtt'), 'empty segment present in playlist');
    const emptyFile = join(testRoot, 'emptytest', 'en', 'seg000001.vtt');
    const content   = await readFile(emptyFile, 'utf8');
    assert.equal(content, 'WEBVTT\n', 'empty segment is bare WEBVTT');
  });

  test('stopSubs cleans up state and files', async () => {
    const ts = new Date().toISOString().replace('Z', '');
    mgr.addCue('stopme', 'en', 'Bye', ts);
    await mgr._flush('stopme');

    await mgr.stopSubs('stopme');

    assert.deepEqual(mgr.getLanguages('stopme'), [], 'state removed after stop');
    assert.equal(mgr.getPlaylist('stopme', 'en'), null, 'playlist null after stop');
  });

  test('invalid lang tags are ignored', () => {
    const ts = new Date().toISOString().replace('Z', '');
    mgr.addCue('safeguard', '../etc/passwd', 'evil', ts);
    mgr.addCue('safeguard', 'a'.repeat(31), 'too long', ts);
    assert.deepEqual(mgr.getLanguages('safeguard'), [], 'invalid langs not tracked');
  });
});
