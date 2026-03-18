/**
 * YouTube Data API v3 helpers for live broadcast management.
 * All functions require a valid OAuth access token.
 */

const YT_API = 'https://www.googleapis.com/youtube/v3';

async function ytFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `YouTube API error ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/**
 * List upcoming (scheduled) live broadcasts for the authenticated user.
 * Fetches all pages (up to 50 per page) and returns the full items array.
 */
export async function listScheduledBroadcasts(token) {
  const items = [];
  let pageToken = undefined;
  do {
    const params = new URLSearchParams({
      part: 'id,snippet,status,contentDetails',
      broadcastStatus: 'upcoming',
      maxResults: '50',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await ytFetch(`${YT_API}/liveBroadcasts?${params}`, token);
    if (data.items) items.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

/**
 * Fetch the live stream details for a broadcast (stream key info, ingestion URL).
 * broadcastItem must have contentDetails.boundStreamId.
 */
export async function getLiveStream(token, streamId) {
  const params = new URLSearchParams({
    part: 'id,snippet,cdn,status',
    id: streamId,
  });
  const data = await ytFetch(`${YT_API}/liveStreams?${params}`, token);
  return (data.items || [])[0] || null;
}

/**
 * Transition a broadcast to a new status.
 * broadcastStatus: 'testing' | 'live' | 'complete'
 */
export async function transitionBroadcast(token, broadcastId, broadcastStatus) {
  const params = new URLSearchParams({
    broadcastStatus,
    id: broadcastId,
    part: 'id,status',
  });
  return ytFetch(`${YT_API}/liveBroadcasts/transition?${params}`, token, { method: 'POST', body: '' });
}

/**
 * Enable HTTP POST closed captions on a broadcast.
 * YouTube requires a 30-second delay for HTTP caption ingestion to align
 * with typical stream latency — this is configured on the YouTube side
 * by setting closedCaptionsType to 'closedCaptionsHttpPost'.
 */
export async function enableHttpCaptions(token, broadcast) {
  const body = {
    id: broadcast.id,
    contentDetails: {
      ...broadcast.contentDetails,
      enableClosedCaptions: true,
      closedCaptionsType: 'closedCaptionsHttpPost',
    },
  };
  return ytFetch(`${YT_API}/liveBroadcasts?part=contentDetails`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
