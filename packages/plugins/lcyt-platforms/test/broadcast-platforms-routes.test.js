/**
 * Full lifecycle against a fake adapter: schedule → thumbnail → go-live →
 * live snapshots → end → summary, plus the failure paths that matter
 * operationally (quota, expired token, partial go-live).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let Database, express;
try {
  Database = (await import('better-sqlite3')).default;
  express = (await import('express')).default;
} catch {
  console.log('# better-sqlite3/express not available — skipping lcyt-platforms broadcast route tests');
  process.exit(0);
}

const {
  runMigrations, upsertCredential, getLink, listStats, insertStats,
  STATS_LIVE_SNAPSHOT, STATS_POST_SUMMARY,
} = await import('../src/db.js');
const { createBroadcastPlatformsRouter } = await import('../src/routes/broadcast-platforms.js');
const { NetworkError } = await import('lcyt/errors');

const iso = (ms) => new Date(ms).toISOString().replace(/Z$/, '');

/** Adapter double recording every call. */
function makeAdapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      platform: 'youtube',
      scopes: [],
      createScheduled: async (t, fields) => {
        calls.push(['createScheduled', fields]);
        return { externalBroadcastId: 'yt-bc-1', externalStreamId: 'yt-st-1', streamKey: 'cdn-key-1' };
      },
      updateSchedule: async (t, id, fields) => { calls.push(['updateSchedule', id, fields]); },
      transition: async (t, id, status) => { calls.push(['transition', id, status]); return { status }; },
      setThumbnail: async (t, id, buf, mime) => {
        calls.push(['setThumbnail', id, buf.length, mime]);
        return { thumbnailUrl: 'https://i.ytimg.com/t.jpg' };
      },
      getStreamKey: async (t, streamId) => { calls.push(['getStreamKey', streamId]); return { streamKey: 'cdn-key-1' }; },
      getLiveStats: async () => ({ concurrentViewers: 10 }),
      getPostBroadcastStats: async () => ({ views: 500, averageWatchTimeSec: 120, peakConcurrentViewers: null }),
      ...overrides,
    },
  };
}

describe('broadcast platform routes', () => {
  let server, baseUrl, db, ref;

  before(async () => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE api_keys (key TEXT PRIMARY KEY)');
    db.exec(`CREATE TABLE broadcasts (
      id TEXT PRIMARY KEY, api_key TEXT, title TEXT, description TEXT,
      scheduled_start TEXT, youtube_broadcast_id TEXT
    )`);
    runMigrations(db);
    for (const k of ['key1', 'key2']) db.prepare('INSERT INTO api_keys (key) VALUES (?)').run(k);

    ref = {
      adapter: makeAdapter(),
      accessToken: async () => 'token',
      startSession: null,
      captionTargets: [],
      events: [],
    };

    // The injected broadcasts interface — the plugin never reaches into
    // lcyt-backend's db modules directly.
    const broadcastsApi = {
      getBroadcast: (database, apiKey, id) => {
        const row = database.prepare('SELECT * FROM broadcasts WHERE id = ? AND api_key = ?').get(id, apiKey);
        return row ? {
          id: row.id, title: row.title, description: row.description,
          scheduledStart: row.scheduled_start, youtubeBroadcastId: row.youtube_broadcast_id,
        } : null;
      },
      updateBroadcast: (database, apiKey, id, patch) => {
        if (patch.youtubeBroadcastId !== undefined) {
          database.prepare('UPDATE broadcasts SET youtube_broadcast_id = ? WHERE id = ? AND api_key = ?')
            .run(patch.youtubeBroadcastId, id, apiKey);
        }
      },
    };

    const captionTargetsApi = {
      list: () => ref.captionTargets,
      create: (database, apiKey, fields) => {
        const target = { id: `t-${ref.captionTargets.length + 1}`, ...fields };
        ref.captionTargets.push(target);
        return { ok: true, target };
      },
      update: (database, apiKey, id, patch) => {
        const target = ref.captionTargets.find(t => t.id === id);
        if (!target) return { ok: false, error: 'not found' };
        Object.assign(target, patch);
        return { ok: true, target };
      },
    };

    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use((req, _res, next) => { req.session = { apiKey: req.headers['x-test-api-key'] || 'key1' }; next(); });
    app.use('/broadcasts/:id/platforms', createBroadcastPlatformsRouter(db, (req, _res, next) => next(), {
      getAdapter: () => ref.adapter.adapter,
      getAccessToken: (...args) => ref.accessToken(...args),
      broadcastsApi,
      captionTargetsApi,
      startSession: (...args) => (ref.startSession ? ref.startSession(...args) : null),
      eventBus: { publish: (projectId, topic, data) => ref.events.push({ projectId, topic, data }) },
    }));

    await new Promise((r) => { server = app.listen(0, r); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((r) => server.close(r)));

  beforeEach(() => {
    ref.adapter = makeAdapter();
    ref.accessToken = async () => 'token';
    ref.startSession = null;
    ref.captionTargets = [];
    ref.events = [];
    db.exec('DELETE FROM broadcast_platform_stats');
    db.exec('DELETE FROM broadcast_platform_links');
    db.exec('DELETE FROM platform_credentials');
    db.exec('DELETE FROM broadcasts');
    db.prepare('INSERT INTO broadcasts (id, api_key, title, description, scheduled_start) VALUES (?,?,?,?,?)')
      .run('b1', 'key1', 'Sunday Service', 'Weekly', '2026-08-02T09:00:00');
  });

  function seedCredential(apiKey = 'key1', externalAccountId = 'UC-a') {
    return upsertCredential(db, apiKey, {
      platform: 'youtube', externalAccountId, accountLabel: externalAccountId,
      accessTokenEnc: 'enc', refreshTokenEnc: 'enc', expiresAt: iso(Date.now() + 3600_000),
    });
  }

  async function call(path, opts = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'key1', ...(opts.headers || {}) },
      ...opts,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const post = (path, body, opts) => call(path, { method: 'POST', body: JSON.stringify(body || {}), ...opts });

  // ── Credential resolution ───────────────────────────────────────────────
  describe('credential resolution', () => {
    test('resolves implicitly when exactly one account is connected', async () => {
      seedCredential();
      const { status } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(status, 200);
    });

    test('409s with a candidate list when several are connected', async () => {
      // The multi-channel UX contract: enough for a client to render a picker
      // without a second round-trip.
      seedCredential('key1', 'UC-a');
      seedCredential('key1', 'UC-b');
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(status, 409);
      assert.equal(body.code, 'ambiguous_credential');
      assert.equal(body.candidates.length, 2);
      assert.ok(!JSON.stringify(body).includes('refresh_token_enc'));
    });

    test('an explicit credentialId disambiguates', async () => {
      seedCredential('key1', 'UC-a');
      const b = seedCredential('key1', 'UC-b');
      const { status } = await post('/broadcasts/b1/platforms/youtube/schedule', { credentialId: b.id });
      assert.equal(status, 200);
      assert.equal(getLink(db, 'b1', 'youtube').credential_id, b.id);
    });

    test('409s with not_connected when no account is connected', async () => {
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(status, 409);
      assert.equal(body.code, 'not_connected');
    });

    test("rejects another project's credentialId", async () => {
      const other = seedCredential('key2', 'UC-other');
      const { status } = await post('/broadcasts/b1/platforms/youtube/schedule', { credentialId: other.id });
      assert.equal(status, 404);
    });

    test('404s on an unsupported platform', async () => {
      seedCredential();
      const { status, body } = await post('/broadcasts/b1/platforms/facebook/schedule');
      assert.equal(status, 404);
      assert.deepEqual(body.supported, ['youtube']);
    });

    test("404s on another project's broadcast", async () => {
      seedCredential('key2');
      const { status } = await post('/broadcasts/b1/platforms/youtube/schedule', {}, {
        headers: { 'x-test-api-key': 'key2' },
      });
      assert.equal(status, 404);
    });
  });

  // ── Schedule ────────────────────────────────────────────────────────────
  describe('schedule', () => {
    test('creates the external broadcast from the LCYT broadcast fields', async () => {
      seedCredential();
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(status, 200);
      const [name, fields] = ref.adapter.calls[0];
      assert.equal(name, 'createScheduled');
      assert.equal(fields.title, 'Sunday Service');
      assert.equal(fields.scheduledStart, '2026-08-02T09:00:00');
      assert.equal(body.link.externalBroadcastId, 'yt-bc-1');
      assert.equal(body.link.lastStatus, 'ready');
    });

    test('mirrors the id onto the legacy youtube_broadcast_id column', async () => {
      // Not a dead column: db/broadcasts.js surfaces it via formatRow() and the
      // broadcasts routes accept it on create and update.
      seedCredential();
      await post('/broadcasts/b1/platforms/youtube/schedule');
      const row = db.prepare('SELECT youtube_broadcast_id FROM broadcasts WHERE id = ?').get('b1');
      assert.equal(row.youtube_broadcast_id, 'yt-bc-1');
    });

    test('updates in place instead of creating a second external broadcast', async () => {
      seedCredential();
      await post('/broadcasts/b1/platforms/youtube/schedule');
      ref.adapter.calls.length = 0;
      await post('/broadcasts/b1/platforms/youtube/schedule', { title: 'Renamed' });
      assert.equal(ref.adapter.calls[0][0], 'updateSchedule');
      assert.equal(ref.adapter.calls[0][1], 'yt-bc-1');
      assert.equal(ref.adapter.calls[0][2].title, 'Renamed');
      assert.ok(!ref.adapter.calls.some(c => c[0] === 'createScheduled'));
    });

    test('refuses a broadcast with no scheduled start', async () => {
      seedCredential();
      db.prepare('UPDATE broadcasts SET scheduled_start = NULL WHERE id = ?').run('b1');
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(status, 400);
      assert.match(body.error, /no scheduled start time/);
    });

    test('records the upstream error on the link when the provider fails', async () => {
      seedCredential();
      await post('/broadcasts/b1/platforms/youtube/schedule');
      ref.adapter = makeAdapter({
        updateSchedule: async () => { throw new NetworkError('YouTube said no', 500); },
      });
      const { status } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(status, 502);
      assert.match(getLink(db, 'b1', 'youtube').last_sync_error, /YouTube said no/);
    });
  });

  // ── Stream-key binding ──────────────────────────────────────────────────
  describe('caption target stream-key binding', () => {
    test('creates a youtube caption target when none exists', async () => {
      // The "connect the dots" gap: getStreamKey existed but nothing ever wrote
      // its result into caption_targets.
      seedCredential();
      const { body } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(body.captionTarget.bound, true);
      assert.equal(body.captionTarget.created, true);
      assert.equal(ref.captionTargets[0].streamKey, 'cdn-key-1');
    });

    test('never silently overwrites an existing hand-entered key', async () => {
      seedCredential();
      ref.captionTargets.push({ id: 't-existing', type: 'youtube', streamKey: 'typed-by-hand' });
      const { body } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(body.captionTarget.bound, false);
      assert.equal(body.captionTarget.reason, 'existing_target');
      assert.equal(body.captionTarget.available, true);
      assert.equal(ref.captionTargets[0].streamKey, 'typed-by-hand');
    });

    test('overwrites only on an explicit bindStreamKey', async () => {
      seedCredential();
      ref.captionTargets.push({ id: 't-existing', type: 'youtube', streamKey: 'typed-by-hand' });
      const { body } = await post('/broadcasts/b1/platforms/youtube/schedule', { bindStreamKey: true });
      assert.equal(body.captionTarget.bound, true);
      assert.equal(ref.captionTargets[0].streamKey, 'cdn-key-1');
    });

    test('a stream-key lookup failure does not fail the schedule', async () => {
      seedCredential();
      ref.adapter = makeAdapter({ getStreamKey: async () => { throw new NetworkError('nope', 500); } });
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/schedule');
      assert.equal(status, 200, 'the broadcast is scheduled; the key is a bonus');
      assert.equal(body.captionTarget.bound, false);
      assert.equal(body.captionTarget.reason, 'lookup_failed');
    });
  });

  // ── Thumbnail ───────────────────────────────────────────────────────────
  describe('thumbnail', () => {
    const png = () => Buffer.from('fake-png').toString('base64');

    async function scheduled() {
      seedCredential();
      await post('/broadcasts/b1/platforms/youtube/schedule');
      ref.adapter.calls.length = 0;
    }

    test('uploads base64 image data', async () => {
      await scheduled();
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/thumbnail', {
        data: png(), mimeType: 'image/png',
      });
      assert.equal(status, 200);
      assert.equal(body.thumbnailUrl, 'https://i.ytimg.com/t.jpg');
      const [name, id, length, mime] = ref.adapter.calls[0];
      assert.equal(name, 'setThumbnail');
      assert.equal(id, 'yt-bc-1');
      assert.equal(length, 8);
      assert.equal(mime, 'image/png');
      assert.equal(getLink(db, 'b1', 'youtube').thumbnail_url, 'https://i.ytimg.com/t.jpg');
    });

    test('requires the broadcast to be scheduled first', async () => {
      seedCredential();
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/thumbnail', {
        data: png(), mimeType: 'image/png',
      });
      assert.equal(status, 409);
      assert.equal(body.code, 'not_linked');
    });

    test('validates mime type, presence and emptiness', async () => {
      await scheduled();
      const cases = [
        [{}, 400],
        [{ data: png() }, 400],
        [{ data: png(), mimeType: 'image/gif' }, 400],
        [{ data: '', mimeType: 'image/png' }, 400],
      ];
      for (const [body, expected] of cases) {
        const { status } = await post('/broadcasts/b1/platforms/youtube/thumbnail', body);
        assert.equal(status, expected, JSON.stringify(body));
      }
    });

    test('rejects data that is not valid base64', async () => {
      // Buffer.from() would silently accept this and hand a short buffer to
      // the provider.
      await scheduled();
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/thumbnail', {
        data: 'not base64!!! @@@', mimeType: 'image/png',
      });
      assert.equal(status, 400);
      assert.match(body.error, /not valid base64/);
    });

    test('rejects an oversized image', async () => {
      await scheduled();
      const { status } = await post('/broadcasts/b1/platforms/youtube/thumbnail', {
        data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'), mimeType: 'image/png',
      });
      assert.equal(status, 413);
    });
  });

  // ── Go live ─────────────────────────────────────────────────────────────
  describe('go-live', () => {
    async function scheduled() {
      seedCredential();
      await post('/broadcasts/b1/platforms/youtube/schedule');
      ref.adapter.calls.length = 0;
      ref.events.length = 0;
    }

    test('transitions and starts the caption session', async () => {
      await scheduled();
      let started = null;
      ref.startSession = async (apiKey, broadcastId) => { started = { apiKey, broadcastId }; return { id: 's1' }; };

      const { status, body } = await post('/broadcasts/b1/platforms/youtube/go-live');
      assert.equal(status, 200);
      assert.equal(body.status, 'live');
      assert.equal(body.captionSessionStarted, true);
      assert.deepEqual(started, { apiKey: 'key1', broadcastId: 'b1' });
      assert.equal(getLink(db, 'b1', 'youtube').last_status, 'live');
      assert.equal(ref.events.at(-1).topic, 'platform.status_changed');
    });

    test('reports partial success when the session fails after a successful transition', async () => {
      // The transition cannot be undone, so the honest answer is "live on
      // YouTube, no captions" — not a 500 implying nothing happened.
      await scheduled();
      ref.startSession = async () => { throw new Error('relay unavailable'); };

      const { status, body } = await post('/broadcasts/b1/platforms/youtube/go-live');
      assert.equal(status, 200);
      assert.equal(body.partial, true);
      assert.equal(body.captionSessionStarted, false);
      assert.match(body.warning, /live on youtube.*caption session did not start/i);
      assert.equal(getLink(db, 'b1', 'youtube').last_status, 'live', 'it really is live');
    });

    test('does not start a session when the transition itself fails', async () => {
      await scheduled();
      let called = false;
      ref.startSession = async () => { called = true; };
      ref.adapter = makeAdapter({ transition: async () => { throw new NetworkError('not bound', 400); } });

      const { status } = await post('/broadcasts/b1/platforms/youtube/go-live');
      assert.equal(status, 502);
      assert.equal(called, false);
      assert.notEqual(getLink(db, 'b1', 'youtube').last_status, 'live');
    });

    test('requires a link', async () => {
      seedCredential();
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/go-live');
      assert.equal(status, 409);
      assert.equal(body.code, 'not_linked');
    });

    test('an expired credential reads as reconnect-required, not a server error', async () => {
      await scheduled();
      const err = new Error('reconnect the account');
      err.name = 'CredentialUnusableError';
      err.reason = 'grant_revoked';
      ref.accessToken = async () => { throw err; };

      const { status, body } = await post('/broadcasts/b1/platforms/youtube/go-live');
      assert.equal(status, 409);
      assert.equal(body.code, 'credential_unusable');
      assert.equal(body.reason, 'grant_revoked');
    });
  });

  // ── End + summary ───────────────────────────────────────────────────────
  describe('end', () => {
    async function live() {
      seedCredential();
      await post('/broadcasts/b1/platforms/youtube/schedule');
      await post('/broadcasts/b1/platforms/youtube/go-live');
      ref.adapter.calls.length = 0;
    }

    test('transitions to complete and writes a summary', async () => {
      await live();
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/end');
      assert.equal(status, 200);
      assert.equal(body.status, 'complete');
      assert.equal(body.summary.views, 500);
      assert.equal(body.summary.averageWatchTimeSec, 120);
      assert.equal(getLink(db, 'b1', 'youtube').last_status, 'complete');
      assert.equal(listStats(db, 'b1', 'youtube', { kind: STATS_POST_SUMMARY }).length, 1);
    });

    test('derives peak concurrent from our own snapshots', async () => {
      // YouTube Analytics exposes no peak-concurrent metric at all.
      await live();
      for (const n of [4, 91, 12]) {
        insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: n });
      }
      const { body } = await post('/broadcasts/b1/platforms/youtube/end');
      assert.equal(body.summary.peakConcurrentViewers, 91);
    });

    test('still records the peak when the analytics call fails', async () => {
      // Analytics lags; a summary fetched seconds after the stream ends can
      // legitimately fail or come back empty.
      await live();
      insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: 55 });
      ref.adapter = makeAdapter({
        getPostBroadcastStats: async () => { throw new NetworkError('not processed yet', 400); },
      });
      const { status, body } = await post('/broadcasts/b1/platforms/youtube/end');
      assert.equal(status, 200, 'ending succeeded; the summary is a bonus');
      assert.equal(body.summary.peakConcurrentViewers, 55);
      assert.equal(body.summary.views, null);
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────────
  describe('stats', () => {
    test('returns the latest snapshot and omits history by default', async () => {
      seedCredential();
      for (const n of [1, 2, 3]) {
        insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: n });
      }
      const { status, body } = await call('/broadcasts/b1/platforms/youtube/stats');
      assert.equal(status, 200);
      assert.equal(body.latest.concurrentViewers, 3);
      assert.equal(body.peakConcurrentViewers, 3);
      assert.equal(body.history, undefined);
    });

    test('?history=1 returns the full series oldest-first for charting', async () => {
      seedCredential();
      for (const n of [5, 9, 3]) {
        insertStats(db, { broadcastId: 'b1', platform: 'youtube', kind: STATS_LIVE_SNAPSHOT, concurrentViewers: n });
      }
      const { body } = await call('/broadcasts/b1/platforms/youtube/stats?history=1');
      assert.deepEqual(body.history.map(h => h.concurrentViewers), [5, 9, 3]);
    });

    test('returns nulls rather than 404 for a broadcast with no stats', async () => {
      seedCredential();
      const { status, body } = await call('/broadcasts/b1/platforms/youtube/stats');
      assert.equal(status, 200);
      assert.equal(body.latest, null);
      assert.equal(body.summary, null);
    });

    test("404s on another project's broadcast", async () => {
      const { status } = await call('/broadcasts/b1/platforms/youtube/stats', {
        headers: { 'x-test-api-key': 'key2' },
      });
      assert.equal(status, 404);
    });
  });

  // ── Links listing ───────────────────────────────────────────────────────
  describe('GET /broadcasts/:id/platforms', () => {
    test('lists the links for a broadcast', async () => {
      seedCredential();
      await post('/broadcasts/b1/platforms/youtube/schedule');
      const { status, body } = await call('/broadcasts/b1/platforms');
      assert.equal(status, 200);
      assert.equal(body.links.length, 1);
      assert.equal(body.links[0].platform, 'youtube');
    });

    test('is empty for an unscheduled broadcast', async () => {
      const { body } = await call('/broadcasts/b1/platforms');
      assert.deepEqual(body.links, []);
    });
  });
});
