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

  test('derives timestamps from EXT-X-PROGRAM-DATE-TIME', async () => {
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
});
