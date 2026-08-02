/**
 * YouTube adapter — YouTube Data API v3 + YouTube Analytics API v2.
 *
 * Plain `fetch()`, no `googleapis` dependency. That matches the style of the
 * client-side `youtubeApi.js` this replaces, and keeps the whole surface
 * stubbable in tests by swapping `globalThis.fetch`.
 *
 * IMPORTANT — this file is not validated against the live API. Per the
 * resolved decisions, development uses mocked adapters only, so every request
 * shape below is written against the published API reference and pinned by
 * assertions in test/youtube-adapter.test.js. All calls funnel through
 * `ytFetch()` so auth, error mapping and quota handling are fixed in exactly
 * one place: if a real-API mismatch turns up in post-merge smoke testing, it is
 * a one-file correction, not a redesign.
 *
 * Endpoints used:
 *   accounts.google.com/o/oauth2/v2/auth       consent screen
 *   oauth2.googleapis.com/token                code exchange + refresh
 *   oauth2.googleapis.com/revoke               disconnect
 *   youtube/v3/channels                        account identity
 *   youtube/v3/liveBroadcasts                  list/insert/update/transition
 *   youtube/v3/liveStreams                     insert + cdn.ingestionInfo (stream key)
 *   youtube/v3/thumbnails/set (upload host)    thumbnail
 *   youtube/v3/videos                          liveStreamingDetails.concurrentViewers
 *   youtubeanalytics/v2/reports                post-broadcast summary
 */
import { NetworkError, ConfigError } from 'lcyt/errors';
import { expiryFromNow } from './base.js';

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const YT_ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2';

/** YouTube's `status.privacyStatus` vocabulary. */
export const PRIVACY_STATUSES = new Set(['public', 'unlisted', 'private']);

/**
 * Both scopes are requested at connect time, not incrementally.
 * `yt-analytics.readonly` is only needed for the post-broadcast summary, but
 * asking for it later would mean a second consent screen mid-broadcast — the
 * plan calls for requesting both up front.
 */
export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

/**
 * Single choke point for every authenticated Data API call.
 *
 * Maps failures onto the repo's `NetworkError` (which carries `statusCode`)
 * rather than a bare Error, so route handlers can distinguish 401 (token dead,
 * reconnect needed) from 403 (quota or permission) from everything else.
 *
 * @param {string} accessToken
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>} parsed JSON, or null for an empty 204-style body
 */
async function ytFetch(accessToken, url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.body !== undefined && !(options.body instanceof Uint8Array)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    // A DNS/socket failure has no status code — surface it as such rather than
    // pretending it was an API rejection.
    throw new NetworkError(`YouTube API request failed: ${err.message}`, null);
  }

  if (!res.ok) {
    let message = `YouTube API error ${res.status}`;
    let reason = null;
    try {
      const body = await res.json();
      message = body?.error?.message || message;
      reason = body?.error?.errors?.[0]?.reason || null;
    } catch { /* non-JSON error body — keep the status-derived message */ }
    const err = new NetworkError(message, res.status);
    // `quotaExceeded`/`rateLimitExceeded` are the ones the stats poller backs
    // off on; keeping the raw reason avoids string-matching the message.
    err.reason = reason;
    throw err;
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new NetworkError('YouTube API returned a non-JSON success body', res.status);
  }
}

/**
 * @param {object} cfg
 * @returns {{ clientId: string, clientSecret: string }}
 */
function requireOAuthConfig(cfg = {}) {
  const { clientId, clientSecret } = cfg;
  if (!clientId || !clientSecret) {
    throw new ConfigError('YouTube OAuth is not configured (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)');
  }
  return { clientId, clientSecret };
}

/**
 * POST to Google's token endpoint. Form-encoded, unauthenticated (the client
 * secret in the body *is* the credential), so it does not go through ytFetch.
 * @param {URLSearchParams} params
 */
async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch (err) {
    throw new NetworkError(`Google token request failed: ${err.message}`, null);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    throw new NetworkError(`Google token request rejected: ${detail}`, res.status);
  }
  return body;
}

export const youtubeAdapter = {
  platform: 'youtube',
  scopes: YOUTUBE_SCOPES,

  /**
   * `access_type=offline` + `prompt=consent` on every connect, deliberately:
   * Google issues a refresh token only on first consent otherwise, so a user
   * reconnecting an already-granted account would come back with no refresh
   * token and every background operation would silently stop working.
   */
  buildAuthUrl(state, redirectUri, cfg = {}) {
    const { clientId } = requireOAuthConfig(cfg);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${OAUTH_AUTH_URL}?${params}`;
  },

  async exchangeCode(code, redirectUri, cfg = {}) {
    const { clientId, clientSecret } = requireOAuthConfig(cfg);
    const body = await tokenRequest(new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }));
    if (!body.refresh_token) {
      // Without one, every background feature this plan exists for is dead on
      // arrival — fail loudly at connect time rather than hours later.
      throw new NetworkError(
        'Google did not return a refresh token — the account may need to be removed from '
        + 'the third-party access list at myaccount.google.com/permissions and reconnected',
        null,
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in,
      expiresAt: expiryFromNow(body.expires_in),
      scopes: body.scope || YOUTUBE_SCOPES.join(' '),
    };
  },

  async refreshAccessToken(refreshToken, cfg = {}) {
    const { clientId, clientSecret } = requireOAuthConfig(cfg);
    const body = await tokenRequest(new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }));
    return {
      accessToken: body.access_token,
      expiresIn: body.expires_in,
      expiresAt: expiryFromNow(body.expires_in),
      // Google usually keeps issuing the same refresh token and omits it here.
      refreshToken: body.refresh_token || null,
    };
  },

  /**
   * Best-effort remote revocation on disconnect, so a disconnected LCYT project
   * doesn't leave a live grant in the user's Google account settings. Returns
   * a boolean instead of throwing — the local revocation must still proceed
   * even if Google rejects this.
   */
  async revokeToken(token) {
    try {
      const res = await fetch(OAUTH_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getAccountIdentity(accessToken) {
    const data = await ytFetch(accessToken, `${YT_API}/channels?part=snippet&mine=true`);
    const channel = (data?.items || [])[0];
    if (!channel) {
      throw new NetworkError('Google account has no YouTube channel', null);
    }
    return {
      externalAccountId: channel.id,
      accountLabel: channel.snippet?.title || channel.id,
    };
  },

  async listUpcoming(accessToken) {
    const items = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        part: 'id,snippet,status,contentDetails',
        broadcastStatus: 'upcoming',
        broadcastType: 'all',
        maxResults: '50',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await ytFetch(accessToken, `${YT_API}/liveBroadcasts?${params}`);
      for (const item of data?.items || []) {
        items.push({
          externalBroadcastId: item.id,
          title: item.snippet?.title || '',
          scheduledStart: item.snippet?.scheduledStartTime || null,
          status: item.status?.lifeCycleStatus || null,
        });
      }
      pageToken = data?.nextPageToken;
    } while (pageToken);
    return items;
  },

  /**
   * Create a scheduled broadcast, its bound stream, and return the CDN stream
   * key in one call — three Data API requests (insert broadcast, insert
   * stream, bind) because YouTube models the broadcast and its ingest stream
   * as separate resources.
   *
   * `enableClosedCaptions` + `closedCaptionsType: 'closedCaptionsHttpPost'` are
   * set at creation. This carries forward the capability the retired
   * `youtubeApi.js#enableHttpCaptions` provided as a separate manual step —
   * without it YouTube rejects LCYT's caption POSTs, which is the entire point
   * of the product, so it is set up front rather than left as an action the
   * operator has to remember.
   */
  async createScheduled(accessToken, { title, description, scheduledStart, privacyStatus } = {}) {
    if (!scheduledStart) {
      throw new NetworkError('A scheduled start time is required to schedule a YouTube broadcast', null);
    }
    // Falls back to the safe value rather than to YouTube's own default: an
    // omitted privacyStatus must never silently publish a broadcast.
    const privacy = PRIVACY_STATUSES.has(privacyStatus) ? privacyStatus : 'unlisted';
    const broadcast = await ytFetch(
      accessToken,
      `${YT_API}/liveBroadcasts?part=snippet,status,contentDetails`,
      {
        method: 'POST',
        body: JSON.stringify({
          snippet: {
            title: title || 'Untitled broadcast',
            description: description || '',
            scheduledStartTime: scheduledStart,
          },
          status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
          contentDetails: {
            enableClosedCaptions: true,
            closedCaptionsType: 'closedCaptionsHttpPost',
            enableAutoStart: false,
            enableAutoStop: false,
          },
        }),
      },
    );

    const stream = await ytFetch(
      accessToken,
      `${YT_API}/liveStreams?part=snippet,cdn,status`,
      {
        method: 'POST',
        body: JSON.stringify({
          snippet: { title: `${title || 'LCYT'} — ingest` },
          cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' },
        }),
      },
    );

    await ytFetch(
      accessToken,
      `${YT_API}/liveBroadcasts/bind?${new URLSearchParams({
        id: broadcast.id, streamId: stream.id, part: 'id,contentDetails',
      })}`,
      { method: 'POST' },
    );

    return {
      externalBroadcastId: broadcast.id,
      externalStreamId: stream.id,
      streamKey: stream.cdn?.ingestionInfo?.streamName || null,
      ingestUrl: stream.cdn?.ingestionInfo?.ingestionAddress || null,
    };
  },

  async updateSchedule(accessToken, externalBroadcastId, { title, description, scheduledStart, privacyStatus } = {}) {
    const snippet = {};
    if (title !== undefined) snippet.title = title;
    if (description !== undefined) snippet.description = description;
    if (scheduledStart !== undefined) snippet.scheduledStartTime = scheduledStart;
    // liveBroadcasts.update replaces the parts it is given, so a title-only
    // edit still has to send scheduledStartTime — YouTube rejects a snippet
    // without it. Callers pass the broadcast's current values for anything
    // they aren't changing.
    //
    // `status` is only sent when a visibility was actually supplied. Including
    // the status part unconditionally would rewrite privacyStatus on every
    // edit, which for an omitted value means silently resetting whatever the
    // operator had set on YouTube.
    const parts = ['snippet'];
    const body = { id: externalBroadcastId, snippet };
    if (PRIVACY_STATUSES.has(privacyStatus)) {
      parts.push('status');
      body.status = { privacyStatus };
    }
    await ytFetch(accessToken, `${YT_API}/liveBroadcasts?part=${parts.join(',')}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async transition(accessToken, externalBroadcastId, status) {
    const params = new URLSearchParams({
      broadcastStatus: status,
      id: externalBroadcastId,
      part: 'id,status',
    });
    const data = await ytFetch(accessToken, `${YT_API}/liveBroadcasts/transition?${params}`, { method: 'POST' });
    return { status: data?.status?.lifeCycleStatus || status };
  },

  /**
   * Thumbnails go to the separate upload host as a raw image body — not JSON,
   * and not multipart. `videoId` is the broadcast id: for a live broadcast the
   * two are the same identifier.
   */
  async setThumbnail(accessToken, externalBroadcastId, image, mimeType) {
    const params = new URLSearchParams({ videoId: externalBroadcastId, uploadType: 'media' });
    const data = await ytFetch(accessToken, `${YT_UPLOAD_API}/thumbnails/set?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': mimeType },
      body: image,
    });
    const item = (data?.items || [])[0];
    return {
      thumbnailUrl: item?.high?.url || item?.medium?.url || item?.default?.url || null,
    };
  },

  /**
   * The capability the old client-side surface already had and nothing ever
   * called into `caption_targets` — see the plan's "connect the dots" gap.
   */
  async getStreamKey(accessToken, externalStreamId) {
    const params = new URLSearchParams({ part: 'id,cdn,status', id: externalStreamId });
    const data = await ytFetch(accessToken, `${YT_API}/liveStreams?${params}`);
    const stream = (data?.items || [])[0];
    return {
      streamKey: stream?.cdn?.ingestionInfo?.streamName || null,
      ingestUrl: stream?.cdn?.ingestionInfo?.ingestionAddress || null,
    };
  },

  /**
   * Concurrent viewers come from the Data API's videos resource, not Analytics
   * — Analytics is batch-processed and lags by hours, so it is useless while
   * live. YouTube omits `concurrentViewers` entirely when the broadcast is not
   * actually streaming, which reads as null rather than 0.
   */
  async getLiveStats(accessToken, externalBroadcastId) {
    const params = new URLSearchParams({ part: 'liveStreamingDetails', id: externalBroadcastId });
    const data = await ytFetch(accessToken, `${YT_API}/videos?${params}`);
    const details = (data?.items || [])[0]?.liveStreamingDetails;
    const raw = details?.concurrentViewers;
    return { concurrentViewers: raw === undefined || raw === null ? null : Number(raw) };
  },

  /**
   * Post-broadcast summary from the Analytics API.
   *
   * Two caveats worth knowing when reading the numbers: Analytics data is not
   * immediate (a summary fetched seconds after the stream ends may come back
   * zeroed and needs re-fetching later), and it exposes no peak-concurrent
   * metric at all — the caller derives that from the live snapshots this
   * plugin recorded itself (`peakConcurrentFromSnapshots`).
   *
   * @param {string} accessToken
   * @param {string} externalBroadcastId
   * @param {{ startDate?: string, endDate?: string }} [opts] YYYY-MM-DD
   */
  async getPostBroadcastStats(accessToken, externalBroadcastId, opts = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: opts.startDate || today,
      endDate: opts.endDate || today,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration',
      filters: `video==${externalBroadcastId}`,
    });
    const data = await ytFetch(accessToken, `${YT_ANALYTICS_API}/reports?${params}`);
    const row = (data?.rows || [])[0] || [];
    const columns = (data?.columnHeaders || []).map(c => c.name);
    const pick = (name) => {
      const i = columns.indexOf(name);
      return i === -1 || row[i] === undefined ? null : Number(row[i]);
    };
    return {
      views: pick('views'),
      // averageViewDuration is already in seconds.
      averageWatchTimeSec: pick('averageViewDuration'),
      peakConcurrentViewers: null,
    };
  },
};

export default youtubeAdapter;
