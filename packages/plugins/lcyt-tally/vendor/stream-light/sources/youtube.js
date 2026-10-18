/**
 * YouTube source: is this stream live?
 *
 * Mode A (OAuth, shows ingest health): `liveBroadcasts.list` for the
 *   authorised channel's active broadcasts (then upcoming), and for a live one
 *   `liveStreams.list` for the bound stream's status and health.
 * Mode B (API key or token, one known video): `videos.list` with
 *   `liveStreamingDetails`. No ingest health, so no DEGRADED.
 *
 * Everything is built from documentation only and has not been run against the
 * real API; the tests use a fake server that pins every request.
 */

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

const LIVE_STATES = new Set(['live']);
const STARTING_STATES = new Set(['liveStarting', 'testing', 'testStarting']);
const UPCOMING_STATES = new Set(['ready', 'created', 'testing', 'testStarting']);

export class YouTubeError extends Error {
  constructor(message, { status = null, reason = null, backoffMs = 0 } = {}) {
    super(message);
    this.name = 'YouTubeError';
    this.status = status;
    this.reason = reason;
    this.backoffMs = backoffMs;
  }
}

/**
 * @param {object} opts
 * @param {'A'|'B'} [opts.mode]
 * @param {typeof fetch} [opts.fetch]
 * @param {(o?: {forceRefresh?: boolean}) => Promise<string>} [opts.getAccessToken]  OAuth access token provider
 * @param {string} [opts.apiKey]      Mode B without OAuth
 * @param {string} [opts.videoId]     Mode B
 * @param {number} [opts.startingWindowMs]  an upcoming broadcast counts as STARTING this close to its start
 * @param {number} [opts.quotaBackoffMs]
 * @param {() => number} [opts.now]
 */
export function createYoutubeSource({
  mode = 'A',
  fetch: fetchImpl = globalThis.fetch,
  getAccessToken,
  apiKey,
  videoId,
  baseUrl = YOUTUBE_API_BASE,
  startingWindowMs = 30 * 60_000,
  quotaBackoffMs = 10 * 60_000,
  timeoutMs = 10_000,
  now = () => Date.now(),
} = {}) {
  if (mode !== 'A' && mode !== 'B') throw new TypeError("mode must be 'A' or 'B'");
  if (mode === 'A' && typeof getAccessToken !== 'function') throw new TypeError('mode A needs getAccessToken');
  if (mode === 'B' && !videoId) throw new TypeError('mode B needs videoId');
  if (mode === 'B' && !apiKey && typeof getAccessToken !== 'function') throw new TypeError('mode B needs apiKey or getAccessToken');

  async function request(path, params) {
    const url = new URL(`${baseUrl}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const attempt = async (forceRefresh) => {
      const headers = { Accept: 'application/json' };
      if (typeof getAccessToken === 'function') {
        headers.Authorization = `Bearer ${await getAccessToken({ forceRefresh })}`;
      } else {
        url.searchParams.set('key', apiKey);
      }
      return fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    };

    let res = await attempt(false);
    if (res.status === 401 && typeof getAccessToken === 'function') res = await attempt(true);
    if (res.ok) return res.json();

    let reason = null;
    try { reason = (await res.json())?.error?.errors?.[0]?.reason ?? null; } catch { /* no body */ }
    if (res.status === 403 && (reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || reason === 'dailyLimitExceeded')) {
      throw new YouTubeError(`YouTube quota exceeded (${reason})`, { status: 403, reason, backoffMs: quotaBackoffMs });
    }
    throw new YouTubeError(`YouTube answered ${res.status}${reason ? ` (${reason})` : ''}`, { status: res.status, reason });
  }

  const startsSoon = (iso) => {
    const t = Date.parse(iso ?? '');
    return Number.isFinite(t) && t - now() <= startingWindowMs && t - now() >= -startingWindowMs;
  };

  async function pollVideo() {
    const data = await request('videos', { part: 'liveStreamingDetails', id: videoId });
    const item = data?.items?.[0];
    if (!item) throw new YouTubeError('video not found');
    const d = item.liveStreamingDetails;
    if (!d) return { state: 'OFF', detail: 'not a live broadcast' };
    if (d.actualEndTime) return { state: 'OFF', detail: 'broadcast ended' };
    if (d.actualStartTime) return { state: 'LIVE', detail: 'broadcast started' };
    if (startsSoon(d.scheduledStartTime)) return { state: 'STARTING', detail: 'scheduled to start soon' };
    return { state: 'OFF', detail: 'not started' };
  }

  async function broadcasts(status) {
    const data = await request('liveBroadcasts', { part: 'id,status,contentDetails,snippet', broadcastStatus: status, maxResults: '10' });
    return Array.isArray(data?.items) ? data.items : [];
  }

  async function streamHealth(streamId) {
    const data = await request('liveStreams', { part: 'status', id: streamId });
    const s = data?.items?.[0]?.status;
    return s ? { streamStatus: s.streamStatus, health: s.healthStatus?.status } : null;
  }

  async function pollBroadcasts() {
    const active = await broadcasts('active');
    const live = active.find((b) => LIVE_STATES.has(b.status?.lifeCycleStatus));
    if (live) {
      const streamId = live.contentDetails?.boundStreamId;
      if (!streamId) return { state: 'LIVE', detail: 'broadcast live, ingest not checked' };
      const h = await streamHealth(streamId);
      if (!h) return { state: 'LIVE', detail: 'broadcast live, stream not found' };
      if (h.streamStatus !== 'active') return { state: 'DEGRADED', detail: `broadcast live but stream is ${h.streamStatus}` };
      if (h.health === 'good') return { state: 'LIVE', detail: 'stream active, health good' };
      return { state: 'DEGRADED', detail: `stream health ${h.health ?? 'unknown'}` };
    }
    if (active.some((b) => STARTING_STATES.has(b.status?.lifeCycleStatus))) {
      return { state: 'STARTING', detail: 'broadcast is starting' };
    }
    const upcoming = await broadcasts('upcoming');
    const soon = upcoming.find((b) => UPCOMING_STATES.has(b.status?.lifeCycleStatus) && startsSoon(b.snippet?.scheduledStartTime));
    if (soon) return { state: 'STARTING', detail: 'scheduled to start soon' };
    return { state: 'OFF', detail: 'no live broadcast' };
  }

  return { poll: () => (mode === 'B' ? pollVideo() : pollBroadcasts()) };
}
