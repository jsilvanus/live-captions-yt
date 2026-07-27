/**
 * Pins the exact wire shape of every YouTube request.
 *
 * Per resolved decision #4 no live API call is ever made during development,
 * which makes this file the only thing standing between a typo and a failure
 * that would surface for the first time in the owner's post-merge smoke test.
 * Assertions are therefore deliberately specific — method, host, path, query
 * params and body — written against the published Data API v3 / Analytics v2
 * reference rather than against the implementation.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { youtubeAdapter, YOUTUBE_SCOPES } = await import('../src/adapters/youtube.js');
const { assertAdapterShape } = await import('../src/adapters/base.js');
const { NetworkError, ConfigError } = await import('lcyt/errors');

const CFG = { clientId: 'client-id-123', clientSecret: 'client-secret-456' };
const TOKEN = 'ya29.access-token';

const realFetch = globalThis.fetch;
/** @type {{url: string, options: object}[]} */
let calls = [];
/** @type {any[]} */
let queue = [];

/** Queue a JSON response for the next fetch call. */
function respond(body, { status = 200, ok = true } = {}) {
  queue.push({ status, ok, body });
}

beforeEach(() => {
  calls = [];
  queue = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch call to ${url} — nothing queued`);
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return {
      ok: next.ok,
      status: next.status,
      json: async () => (typeof next.body === 'string' ? JSON.parse(next.body) : next.body),
      text: async () => text,
    };
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

/** Parse the nth recorded call's URL. */
const urlOf = (i = 0) => new URL(calls[i].url);
const bodyOf = (i = 0) => JSON.parse(calls[i].options.body);
const formOf = (i = 0) => new URLSearchParams(calls[i].options.body);

describe('interface conformance', () => {
  test('implements the full adapter interface', () => {
    assertAdapterShape(youtubeAdapter, 'youtubeAdapter');
    assert.equal(youtubeAdapter.platform, 'youtube');
  });

  test('requests both the youtube and analytics scopes', () => {
    // The analytics scope is only used post-broadcast, but asking later would
    // mean a second consent screen mid-event.
    assert.deepEqual(YOUTUBE_SCOPES, [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ]);
  });
});

describe('buildAuthUrl', () => {
  test('targets Google consent with offline access and forced consent', () => {
    const url = new URL(youtubeAdapter.buildAuthUrl('state-abc', 'https://lcyt.test/cb', CFG));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), 'client-id-123');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://lcyt.test/cb');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'state-abc');
    // Both are load-bearing: without them Google issues no refresh token on a
    // reconnect, and every background feature silently stops working.
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('scope'), YOUTUBE_SCOPES.join(' '));
  });

  test('throws ConfigError when OAuth is not configured', () => {
    assert.throws(() => youtubeAdapter.buildAuthUrl('s', 'https://x/cb', {}), ConfigError);
    assert.throws(() => youtubeAdapter.buildAuthUrl('s', 'https://x/cb', { clientId: 'only-id' }), ConfigError);
  });
});

describe('exchangeCode', () => {
  test('form-encodes an authorization_code grant', async () => {
    respond({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: 'a b' });
    const result = await youtubeAdapter.exchangeCode('the-code', 'https://lcyt.test/cb', CFG);

    assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const form = formOf(0);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'the-code');
    assert.equal(form.get('client_secret'), 'client-secret-456');
    assert.equal(form.get('redirect_uri'), 'https://lcyt.test/cb');

    assert.equal(result.accessToken, 'at');
    assert.equal(result.refreshToken, 'rt');
    assert.equal(result.expiresIn, 3599);
    assert.match(result.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(!result.expiresAt.endsWith('Z'), 'repo convention: no trailing Z');
  });

  test('fails loudly when Google returns no refresh token', async () => {
    // Silently accepting this would leave scheduling and stats broken with no
    // signal until the access token expired an hour later.
    respond({ access_token: 'at', expires_in: 3599 });
    await assert.rejects(
      () => youtubeAdapter.exchangeCode('c', 'https://lcyt.test/cb', CFG),
      /did not return a refresh token/,
    );
  });

  test('surfaces a rejected exchange with its status code', async () => {
    respond({ error: 'invalid_grant', error_description: 'Bad code' }, { ok: false, status: 400 });
    await assert.rejects(
      () => youtubeAdapter.exchangeCode('c', 'https://lcyt.test/cb', CFG),
      (err) => err instanceof NetworkError && err.statusCode === 400 && /Bad code/.test(err.message),
    );
  });
});

describe('refreshAccessToken', () => {
  test('form-encodes a refresh_token grant', async () => {
    respond({ access_token: 'at2', expires_in: 3599 });
    const result = await youtubeAdapter.refreshAccessToken('rt', CFG);
    const form = formOf(0);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'rt');
    assert.equal(result.accessToken, 'at2');
    // Google normally omits the refresh token on refresh; null tells the
    // caller "keep the one you have" rather than overwriting it with undefined.
    assert.equal(result.refreshToken, null);
  });

  test('passes through a rotated refresh token when one is returned', async () => {
    respond({ access_token: 'at2', expires_in: 60, refresh_token: 'rt-new' });
    assert.equal((await youtubeAdapter.refreshAccessToken('rt', CFG)).refreshToken, 'rt-new');
  });
});

describe('getAccountIdentity', () => {
  test('reads the authenticated channel', async () => {
    respond({ items: [{ id: 'UC123', snippet: { title: 'My Channel' } }] });
    const identity = await youtubeAdapter.getAccountIdentity(TOKEN);
    const url = urlOf(0);
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/channels');
    assert.equal(url.searchParams.get('part'), 'snippet');
    assert.equal(url.searchParams.get('mine'), 'true');
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(identity, { externalAccountId: 'UC123', accountLabel: 'My Channel' });
  });

  test('rejects a Google account with no channel', async () => {
    respond({ items: [] });
    await assert.rejects(() => youtubeAdapter.getAccountIdentity(TOKEN), /no YouTube channel/);
  });
});

describe('listUpcoming', () => {
  test('normalises items and follows pagination', async () => {
    respond({
      items: [{ id: 'b1', snippet: { title: 'One', scheduledStartTime: '2026-08-01T10:00:00Z' }, status: { lifeCycleStatus: 'ready' } }],
      nextPageToken: 'page2',
    });
    respond({ items: [{ id: 'b2', snippet: { title: 'Two' }, status: { lifeCycleStatus: 'created' } }] });

    const items = await youtubeAdapter.listUpcoming(TOKEN);
    assert.equal(calls.length, 2);
    assert.equal(urlOf(0).searchParams.get('broadcastStatus'), 'upcoming');
    assert.equal(urlOf(0).searchParams.get('maxResults'), '50');
    assert.equal(urlOf(0).searchParams.get('pageToken'), null);
    assert.equal(urlOf(1).searchParams.get('pageToken'), 'page2');
    assert.deepEqual(items.map(i => i.externalBroadcastId), ['b1', 'b2']);
    assert.equal(items[0].scheduledStart, '2026-08-01T10:00:00Z');
    assert.equal(items[1].scheduledStart, null);
  });
});

describe('createScheduled', () => {
  test('inserts the broadcast, inserts the stream, binds them, returns the key', async () => {
    respond({ id: 'bc-1' });
    respond({ id: 'st-1', cdn: { ingestionInfo: { streamName: 'abcd-key', ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2' } } });
    respond({ id: 'bc-1' });

    const result = await youtubeAdapter.createScheduled(TOKEN, {
      title: 'Sunday Service', description: 'Weekly', scheduledStart: '2026-08-02T09:00:00Z',
    });

    assert.equal(calls.length, 3);

    // 1 — liveBroadcasts.insert
    assert.equal(urlOf(0).pathname, '/youtube/v3/liveBroadcasts');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(urlOf(0).searchParams.get('part'), 'snippet,status,contentDetails');
    const insert = bodyOf(0);
    assert.equal(insert.snippet.title, 'Sunday Service');
    assert.equal(insert.snippet.scheduledStartTime, '2026-08-02T09:00:00Z');
    // The capability carried over from the retired youtubeApi.js — without it
    // YouTube rejects LCYT's caption POSTs entirely.
    assert.equal(insert.contentDetails.enableClosedCaptions, true);
    assert.equal(insert.contentDetails.closedCaptionsType, 'closedCaptionsHttpPost');

    // 2 — liveStreams.insert
    assert.equal(urlOf(1).pathname, '/youtube/v3/liveStreams');
    assert.equal(bodyOf(1).cdn.ingestionType, 'rtmp');

    // 3 — liveBroadcasts.bind
    assert.equal(urlOf(2).pathname, '/youtube/v3/liveBroadcasts/bind');
    assert.equal(urlOf(2).searchParams.get('id'), 'bc-1');
    assert.equal(urlOf(2).searchParams.get('streamId'), 'st-1');

    assert.deepEqual(result, {
      externalBroadcastId: 'bc-1',
      externalStreamId: 'st-1',
      streamKey: 'abcd-key',
      ingestUrl: 'rtmp://a.rtmp.youtube.com/live2',
    });
  });

  test('requires a scheduled start time', async () => {
    await assert.rejects(() => youtubeAdapter.createScheduled(TOKEN, { title: 'x' }), /scheduled start time is required/);
    assert.equal(calls.length, 0, 'must not call the API without one');
  });
});

describe('updateSchedule', () => {
  test('PUTs only the fields it was given', async () => {
    respond({ id: 'bc-1' });
    await youtubeAdapter.updateSchedule(TOKEN, 'bc-1', { title: 'New title', scheduledStart: '2026-08-02T10:00:00Z' });
    assert.equal(calls[0].options.method, 'PUT');
    assert.equal(urlOf(0).searchParams.get('part'), 'snippet');
    const body = bodyOf(0);
    assert.equal(body.id, 'bc-1');
    assert.equal(body.snippet.title, 'New title');
    assert.equal(body.snippet.scheduledStartTime, '2026-08-02T10:00:00Z');
    assert.equal('description' in body.snippet, false);
  });
});

describe('transition', () => {
  test('POSTs the requested lifecycle status', async () => {
    respond({ id: 'bc-1', status: { lifeCycleStatus: 'live' } });
    const result = await youtubeAdapter.transition(TOKEN, 'bc-1', 'live');
    assert.equal(urlOf(0).pathname, '/youtube/v3/liveBroadcasts/transition');
    assert.equal(urlOf(0).searchParams.get('broadcastStatus'), 'live');
    assert.equal(urlOf(0).searchParams.get('id'), 'bc-1');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(result, { status: 'live' });
  });

  test('falls back to the requested status when the response omits it', async () => {
    respond({ id: 'bc-1' });
    assert.deepEqual(await youtubeAdapter.transition(TOKEN, 'bc-1', 'complete'), { status: 'complete' });
  });
});

describe('setThumbnail', () => {
  test('posts raw image bytes to the upload host', async () => {
    respond({ items: [{ default: { url: 'https://i.ytimg.com/d.jpg' }, high: { url: 'https://i.ytimg.com/h.jpg' } }] });
    const image = Buffer.from('fake-png-bytes');
    const result = await youtubeAdapter.setThumbnail(TOKEN, 'bc-1', image, 'image/png');

    const url = urlOf(0);
    // The upload host, not the regular API host — a common way to get this wrong.
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set');
    assert.equal(url.searchParams.get('videoId'), 'bc-1');
    assert.equal(url.searchParams.get('uploadType'), 'media');
    assert.equal(calls[0].options.headers['Content-Type'], 'image/png');
    assert.equal(calls[0].options.body, image, 'raw bytes, not JSON or multipart');
    assert.equal(result.thumbnailUrl, 'https://i.ytimg.com/h.jpg');
  });

  test('falls back down the thumbnail size list', async () => {
    respond({ items: [{ default: { url: 'https://i.ytimg.com/d.jpg' } }] });
    const result = await youtubeAdapter.setThumbnail(TOKEN, 'bc-1', Buffer.from('x'), 'image/jpeg');
    assert.equal(result.thumbnailUrl, 'https://i.ytimg.com/d.jpg');
  });
});

describe('getStreamKey', () => {
  test('reads cdn.ingestionInfo off the stream resource', async () => {
    respond({ items: [{ id: 'st-1', cdn: { ingestionInfo: { streamName: 'key-xyz', ingestionAddress: 'rtmp://x' } } }] });
    const result = await youtubeAdapter.getStreamKey(TOKEN, 'st-1');
    assert.equal(urlOf(0).pathname, '/youtube/v3/liveStreams');
    assert.equal(urlOf(0).searchParams.get('id'), 'st-1');
    assert.deepEqual(result, { streamKey: 'key-xyz', ingestUrl: 'rtmp://x' });
  });

  test('returns nulls for an unknown stream rather than throwing', async () => {
    respond({ items: [] });
    assert.deepEqual(await youtubeAdapter.getStreamKey(TOKEN, 'nope'), { streamKey: null, ingestUrl: null });
  });
});

describe('getLiveStats', () => {
  test('reads concurrentViewers from the Data API, not Analytics', async () => {
    // Analytics lags by hours, so it is useless while live.
    respond({ items: [{ liveStreamingDetails: { concurrentViewers: '137' } }] });
    const stats = await youtubeAdapter.getLiveStats(TOKEN, 'bc-1');
    assert.equal(urlOf(0).pathname, '/youtube/v3/videos');
    assert.equal(urlOf(0).searchParams.get('part'), 'liveStreamingDetails');
    assert.equal(urlOf(0).searchParams.get('id'), 'bc-1');
    assert.deepEqual(stats, { concurrentViewers: 137 }, 'the API returns a string; callers need a number');
  });

  test('reports null (not 0) when the broadcast is not streaming', async () => {
    // YouTube omits the field entirely; 0 would be a real measurement and read
    // as "nobody is watching" rather than "not live".
    respond({ items: [{ liveStreamingDetails: {} }] });
    assert.deepEqual(await youtubeAdapter.getLiveStats(TOKEN, 'bc-1'), { concurrentViewers: null });
    respond({ items: [] });
    assert.deepEqual(await youtubeAdapter.getLiveStats(TOKEN, 'bc-1'), { concurrentViewers: null });
  });
});

describe('getPostBroadcastStats', () => {
  test('queries the Analytics reports endpoint filtered to the video', async () => {
    respond({
      columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'averageViewDuration' }],
      rows: [[500, 900, 118]],
    });
    const stats = await youtubeAdapter.getPostBroadcastStats(TOKEN, 'bc-1', { startDate: '2026-08-02', endDate: '2026-08-03' });

    const url = urlOf(0);
    assert.equal(url.origin + url.pathname, 'https://youtubeanalytics.googleapis.com/v2/reports');
    assert.equal(url.searchParams.get('ids'), 'channel==MINE');
    assert.equal(url.searchParams.get('filters'), 'video==bc-1');
    assert.equal(url.searchParams.get('startDate'), '2026-08-02');
    assert.equal(url.searchParams.get('endDate'), '2026-08-03');

    assert.equal(stats.views, 500);
    assert.equal(stats.averageWatchTimeSec, 118);
    // Analytics exposes no peak-concurrent metric; the caller derives it from
    // the live snapshots this plugin recorded itself.
    assert.equal(stats.peakConcurrentViewers, null);
  });

  test('reads by column name, not position', async () => {
    respond({ columnHeaders: [{ name: 'averageViewDuration' }, { name: 'views' }], rows: [[42, 7]] });
    const stats = await youtubeAdapter.getPostBroadcastStats(TOKEN, 'bc-1');
    assert.equal(stats.views, 7);
    assert.equal(stats.averageWatchTimeSec, 42);
  });

  test('handles an empty report (data not processed yet)', async () => {
    respond({ columnHeaders: [{ name: 'views' }], rows: [] });
    const stats = await youtubeAdapter.getPostBroadcastStats(TOKEN, 'bc-1');
    assert.equal(stats.views, null);
  });

  test('defaults the date range to today', async () => {
    respond({ columnHeaders: [], rows: [] });
    await youtubeAdapter.getPostBroadcastStats(TOKEN, 'bc-1');
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(urlOf(0).searchParams.get('startDate'), today);
  });
});

describe('error mapping', () => {
  test('a 401 maps to NetworkError with its status code', async () => {
    respond({ error: { message: 'Invalid Credentials' } }, { ok: false, status: 401 });
    await assert.rejects(
      () => youtubeAdapter.getAccountIdentity(TOKEN),
      (err) => err instanceof NetworkError && err.statusCode === 401 && /Invalid Credentials/.test(err.message),
    );
  });

  test('a 403 preserves the machine-readable quota reason', async () => {
    // The stats poller backs off on this rather than string-matching a message
    // that Google is free to reword.
    respond(
      { error: { message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } },
      { ok: false, status: 403 },
    );
    await assert.rejects(
      () => youtubeAdapter.getLiveStats(TOKEN, 'bc-1'),
      (err) => err.statusCode === 403 && err.reason === 'quotaExceeded',
    );
  });

  test('a network-level failure has no status code', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(
      () => youtubeAdapter.getAccountIdentity(TOKEN),
      (err) => err instanceof NetworkError && err.statusCode === null,
    );
  });

  test('a non-JSON error body still yields a status-derived message', async () => {
    respond('<html>502 Bad Gateway</html>', { ok: false, status: 502 });
    await assert.rejects(
      () => youtubeAdapter.getAccountIdentity(TOKEN),
      (err) => err.statusCode === 502 && /502/.test(err.message),
    );
  });

  test('an empty success body is not a parse error', async () => {
    // transition/bind can legitimately return no content.
    respond('');
    assert.doesNotReject(() => youtubeAdapter.updateSchedule(TOKEN, 'bc-1', { title: 'x' }));
  });
});
