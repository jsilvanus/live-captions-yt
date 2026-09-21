/**
 * HlsSegmentFetcher unit tests.
 * Mocks the global fetch so no real HTTP calls are made.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HlsSegmentFetcher } from '../src/hls-segment-fetcher.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlaylist({ mediaSequence = 0, segments = [], programDateTime = null } = {}) {
  let lines = ['#EXTM3U', '#EXT-X-VERSION:6', `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`];
  let first = true;
  for (const { duration, name } of segments) {
    if (first && programDateTime) {
      lines.push(`#EXT-X-PROGRAM-DATE-TIME:${programDateTime.toISOString()}`);
    }
    lines.push(`#EXTINF:${duration},`);
    lines.push(name);
    first = false;
  }
  return lines.join('\n');
}

function makeFetch({ playlistText, segmentBytes = Buffer.from('fakemp4') } = {}) {
  return async function mockFetch(url) {
    if (url.endsWith('.m3u8')) {
      return {
        ok: true,
        status: 200,
        text: async () => playlistText,
      };
    }
    // Segment fetch
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => segmentBytes.buffer.slice(
        segmentBytes.byteOffset,
        segmentBytes.byteOffset + segmentBytes.byteLength
      ),
    };
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('HlsSegmentFetcher', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('emits no segment when playlist returns 404', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404 });

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000, // don't actually poll in tests
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    await fetcher._fetchAndEmit();

    assert.equal(segments.length, 0);
  });

  test('emits segment with fallback timestamp when no EXT-X-PROGRAM-DATE-TIME', async () => {
    const playlist = makePlaylist({
      mediaSequence: 0,
      segments: [{ duration: 6, name: 'seg001.mp4' }],
    });

    globalThis.fetch = makeFetch({ playlistText: playlist });

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    const before = new Date();
    await fetcher._fetchAndEmit();
    const after = new Date();

    assert.equal(segments.length, 1);
    assert.ok(segments[0].timestamp >= before && segments[0].timestamp <= after);
    assert.equal(segments[0].duration, 6);
    assert.equal(segments[0].index, 0);
    assert.ok(Buffer.isBuffer(segments[0].buffer));
  });

  test('derives timestamps from EXT-X-PROGRAM-DATE-TIME (full window, startAtLiveEdge off)', async () => {
    const baseTime = new Date('2026-03-01T12:00:00.000Z');
    const playlist = makePlaylist({
      mediaSequence: 5,
      programDateTime: baseTime,
      segments: [
        { duration: 6, name: 'seg005.mp4' },
        { duration: 6, name: 'seg006.mp4' },
      ],
    });

    globalThis.fetch = makeFetch({ playlistText: playlist });

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
      startAtLiveEdge: false,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    await fetcher._fetchAndEmit();

    assert.equal(segments.length, 2);
    assert.equal(segments[0].timestamp.getTime(), baseTime.getTime());
    assert.equal(segments[1].timestamp.getTime(), baseTime.getTime() + 6000);
    assert.equal(segments[0].index, 5);
    assert.equal(segments[1].index, 6);
  });

  test('default startAtLiveEdge skips the backlog on the first poll, then continues normally', async () => {
    const playlist1 = makePlaylist({
      mediaSequence: 5,
      segments: [
        { duration: 6, name: 'seg005.mp4' },
        { duration: 6, name: 'seg006.mp4' },
        { duration: 6, name: 'seg007.mp4' },
      ],
    });

    globalThis.fetch = makeFetch({ playlistText: playlist1 });

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    await fetcher._fetchAndEmit();

    // Only the newest segment of the initial window is emitted
    assert.equal(segments.length, 1);
    assert.equal(segments[0].index, 7);

    // Window advances by one — only the genuinely new segment is emitted
    const playlist2 = makePlaylist({
      mediaSequence: 6,
      segments: [
        { duration: 6, name: 'seg006.mp4' },
        { duration: 6, name: 'seg007.mp4' },
        { duration: 6, name: 'seg008.mp4' },
      ],
    });
    globalThis.fetch = makeFetch({ playlistText: playlist2 });

    await fetcher._fetchAndEmit();
    assert.equal(segments.length, 2);
    assert.equal(segments[1].index, 8);
  });

  test('skips already-seen segments based on mediaSequence', async () => {
    const playlist = makePlaylist({
      mediaSequence: 3,
      segments: [
        { duration: 6, name: 'seg003.mp4' },
        { duration: 6, name: 'seg004.mp4' },
      ],
    });

    globalThis.fetch = makeFetch({ playlistText: playlist });

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
    });
    // Simulate we already processed up to index 3
    fetcher._lastSequence = 3;

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    await fetcher._fetchAndEmit();

    // Only seg004 (index 4) is new
    assert.equal(segments.length, 1);
    assert.equal(segments[0].index, 4);
  });

  test('emits error when segment fetch fails', async () => {
    const playlist = makePlaylist({
      mediaSequence: 0,
      segments: [{ duration: 6, name: 'seg001.mp4' }],
    });

    globalThis.fetch = async (url) => {
      if (url.endsWith('.m3u8')) {
        return { ok: true, status: 200, text: async () => playlist };
      }
      return { ok: false, status: 500 };
    };

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
    });

    const errors = [];
    fetcher.on('error', e => errors.push(e));

    await fetcher._fetchAndEmit();

    assert.equal(errors.length, 1);
    assert.ok(errors[0].error.message.includes('500'));
  });

  test('stop() emits stopped and prevents further polls', () => {
    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
    });

    const stoppedEvents = [];
    fetcher.on('stopped', () => stoppedEvents.push(true));

    fetcher.stop();

    assert.equal(stoppedEvents.length, 1);
    assert.equal(fetcher._running, false);
    assert.equal(fetcher._stopped, true);
  });

  test('stop() is idempotent', () => {
    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
    });

    const stoppedEvents = [];
    fetcher.on('stopped', () => stoppedEvents.push(true));

    fetcher.stop();
    fetcher.stop();

    assert.equal(stoppedEvents.length, 1);
  });

  test('playlistUrl is derived from hlsBase and streamKey', () => {
    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://mediamtx:8888/',
      streamKey: 'mystream',
      pollIntervalMs: 10000,
    });
    assert.equal(fetcher.playlistUrl, 'http://mediamtx:8888/mystream/index.m3u8');
  });

  test('EXT-X-MAP init segment is prepended to media segments', async () => {
    const initData = Buffer.from('INIT_DATA');
    const segData = Buffer.from('SEG_DATA');
    let fetchCount = 0;

    globalThis.fetch = async (url) => {
      if (url.endsWith('.m3u8')) {
        const playlist = [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-MAP:URI="init.mp4"',
          '#EXTINF:6,',
          'seg001.mp4',
        ].join('\n');
        return { ok: true, status: 200, text: async () => playlist };
      }
      if (url.includes('init.mp4')) {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => initData.buffer.slice(initData.byteOffset, initData.byteOffset + initData.byteLength),
        };
      }
      // Segment fetch
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => segData.buffer.slice(segData.byteOffset, segData.byteOffset + segData.byteLength),
      };
    };

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
      startAtLiveEdge: false,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    await fetcher._fetchAndEmit();

    assert.equal(segments.length, 1);
    // The buffer should be init + media data
    assert.equal(segments[0].buffer.length, initData.length + segData.length);
    assert.deepEqual(segments[0].buffer.slice(0, initData.length), initData);
    assert.deepEqual(segments[0].buffer.slice(initData.length), segData);
    // Init segment should have been fetched once
    assert.equal(fetchCount, 1);
  });

  test('init segment is cached and reused across media segments', async () => {
    const initData = Buffer.from('INIT');
    const seg1Data = Buffer.from('SEG1');
    const seg2Data = Buffer.from('SEG2');
    let initFetchCount = 0;

    globalThis.fetch = async (url) => {
      if (url.endsWith('.m3u8')) {
        const playlist = [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXT-X-MAP:URI="init.mp4"',
          '#EXTINF:6,',
          'seg001.mp4',
          '#EXTINF:6,',
          'seg002.mp4',
        ].join('\n');
        return { ok: true, status: 200, text: async () => playlist };
      }
      if (url.includes('init.mp4')) {
        initFetchCount++;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => initData.buffer.slice(initData.byteOffset, initData.byteOffset + initData.byteLength),
        };
      }
      if (url.includes('seg001')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => seg1Data.buffer.slice(seg1Data.byteOffset, seg1Data.byteOffset + seg1Data.byteLength),
        };
      }
      // seg002
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => seg2Data.buffer.slice(seg2Data.byteOffset, seg2Data.byteOffset + seg2Data.byteLength),
      };
    };

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
      startAtLiveEdge: false,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    await fetcher._fetchAndEmit();

    assert.equal(segments.length, 2);
    // Init should have been fetched only once
    assert.equal(initFetchCount, 1);
    // Both segments should have init prepended
    assert.equal(segments[0].buffer.slice(initData.length).length, seg1Data.length);
    assert.equal(segments[1].buffer.slice(initData.length).length, seg2Data.length);
  });

  test('init segment URI change refetches', async () => {
    const initData1 = Buffer.from('INIT1');
    const initData2 = Buffer.from('INIT2');
    const segData = Buffer.from('SEG');
    let initFetchCount = 0;

    let playlistVersion = 0;
    globalThis.fetch = async (url) => {
      if (url.endsWith('.m3u8')) {
        // First poll has init.mp4, second poll has init2.mp4
        const initUri = playlistVersion === 0 ? 'init.mp4' : 'init2.mp4';
        playlistVersion++;
        const playlist = [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          '#EXT-X-MEDIA-SEQUENCE:' + (playlistVersion - 1),
          `#EXT-X-MAP:URI="${initUri}"`,
          '#EXTINF:6,',
          `seg${String(playlistVersion).padStart(3, '0')}.mp4`,
        ].join('\n');
        return { ok: true, status: 200, text: async () => playlist };
      }
      if (url.includes('init.mp4')) {
        initFetchCount++;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => initData1.buffer.slice(initData1.byteOffset, initData1.byteOffset + initData1.byteLength),
        };
      }
      if (url.includes('init2.mp4')) {
        initFetchCount++;
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => initData2.buffer.slice(initData2.byteOffset, initData2.byteOffset + initData2.byteLength),
        };
      }
      // Segment fetch
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => segData.buffer.slice(segData.byteOffset, segData.byteOffset + segData.byteLength),
      };
    };

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
      startAtLiveEdge: false,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    // First poll
    await fetcher._fetchAndEmit();
    assert.equal(segments.length, 1);
    assert.equal(initFetchCount, 1);

    // Second poll with different init URI
    await fetcher._fetchAndEmit();
    assert.equal(segments.length, 2);
    // Init should have been fetched again for the new URI
    assert.equal(initFetchCount, 2);
  });

  test('no EXT-X-MAP means segments are unchanged', async () => {
    const segData = Buffer.from('SEGMENT_DATA');

    globalThis.fetch = async (url) => {
      if (url.endsWith('.m3u8')) {
        // Playlist without EXT-X-MAP
        const playlist = [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          '#EXT-X-MEDIA-SEQUENCE:0',
          '#EXTINF:6,',
          'seg001.mp4',
        ].join('\n');
        return { ok: true, status: 200, text: async () => playlist };
      }
      // Segment fetch
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => segData.buffer.slice(segData.byteOffset, segData.byteOffset + segData.byteLength),
      };
    };

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
      startAtLiveEdge: false,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));

    await fetcher._fetchAndEmit();

    assert.equal(segments.length, 1);
    // Segment buffer should be unchanged (no init prepended)
    assert.deepEqual(segments[0].buffer, segData);
  });

  test('init segment fetch error skips segments and retries fetch on next poll', async () => {
    const segData = Buffer.from('SEGMENT_DATA');
    const initData = Buffer.from('INIT_DATA');
    const errors = [];
    let pollCount = 0;

    globalThis.fetch = async (url) => {
      if (url.endsWith('.m3u8')) {
        pollCount++;
        const playlist = [
          '#EXTM3U',
          '#EXT-X-VERSION:6',
          '#EXT-X-MEDIA-SEQUENCE:' + (pollCount - 1),
          '#EXT-X-MAP:URI="init.mp4"',
          '#EXTINF:6,',
          `seg${String(pollCount).padStart(3, '0')}.mp4`,
        ].join('\n');
        return { ok: true, status: 200, text: async () => playlist };
      }
      if (url.includes('init.mp4')) {
        // Init fails on first poll, succeeds on second
        if (pollCount === 1) {
          return { ok: false, status: 500 };
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => initData.buffer.slice(initData.byteOffset, initData.byteOffset + initData.byteLength),
        };
      }
      // Segment fetch
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => segData.buffer.slice(segData.byteOffset, segData.byteOffset + segData.byteLength),
      };
    };

    const fetcher = new HlsSegmentFetcher({
      hlsBase: 'http://localhost:8888',
      streamKey: 'testkey',
      pollIntervalMs: 10000,
      startAtLiveEdge: false,
    });

    const segments = [];
    fetcher.on('segment', s => segments.push(s));
    fetcher.on('error', e => errors.push(e));

    // First poll: init fetch fails, segment should be skipped (not emitted)
    await fetcher._fetchAndEmit();
    assert.equal(errors.length, 1);
    assert.ok(errors[0].error.message.includes('Init segment fetch failed'));
    assert.equal(segments.length, 0, 'Segment should be skipped when init fetch fails');

    // Second poll: init fetch succeeds, segment should be emitted WITH init prepended
    errors.length = 0;
    await fetcher._fetchAndEmit();
    assert.equal(errors.length, 0, 'No errors on second poll');
    assert.equal(segments.length, 1, 'Segment should be emitted when init fetch succeeds');
    // Verify init was prepended
    assert.equal(segments[0].buffer.length, initData.length + segData.length);
    assert.deepEqual(segments[0].buffer.slice(0, initData.length), initData);
    assert.deepEqual(segments[0].buffer.slice(initData.length), segData);
  });
});
