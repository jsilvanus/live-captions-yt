/**
 * Feeds of a broadcast recording. A broadcast can leave up to three recordings that share a
 * `group_id`: `clean` (what the encoder sent, no graphics), `program` (clean plus DSK, what went
 * out) and `dsk` (graphics only). Each one is an ordinary `videos` row; this table says which
 * feed it is and carries its metadata (parts and offsets, key parameters).
 */
export const FEED_ROLES = ['clean', 'program', 'dsk'];

function parseMeta(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function formatRow(row) {
  return {
    videoId: row.video_id,
    groupId: row.group_id,
    role: row.role,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
  };
}

/** @param {import('./connection.js').Db} db */
export async function registerVideoFeed(db, apiKey, { videoId, groupId, role, meta = {} }) {
  if (!FEED_ROLES.includes(role)) throw new Error(`Unknown feed role: ${role}`);
  await db.video_feeds.create({
    data: { video_id: videoId, api_key: apiKey, group_id: groupId, role, meta_json: JSON.stringify(meta) },
  });
}

/** Merge new fields into a feed's metadata. */
export async function updateVideoFeedMeta(db, videoId, patch) {
  const row = await db.video_feeds.findUnique({ where: { video_id: videoId } });
  if (!row) return null;
  const meta = { ...parseMeta(row.meta_json), ...patch };
  await db.video_feeds.update({ where: { video_id: videoId }, data: { meta_json: JSON.stringify(meta) } });
  return meta;
}

export async function getVideoFeed(db, videoId) {
  const row = await db.video_feeds.findUnique({ where: { video_id: videoId } });
  return row ? formatRow(row) : null;
}

/** Feeds of one group, clean first. */
export async function listGroupFeeds(db, apiKey, groupId) {
  const rows = await db.video_feeds.findMany({ where: { api_key: apiKey, group_id: groupId } });
  return rows.map(formatRow).sort((a, b) => FEED_ROLES.indexOf(a.role) - FEED_ROLES.indexOf(b.role));
}

/** Newest group of a broadcast, or null. */
export async function findGroupForBroadcast(db, apiKey, broadcastId) {
  const videos = await db.videos.findMany({ where: { api_key: apiKey, broadcast_id: broadcastId }, orderBy: { created_at: 'desc' } });
  for (const v of videos) {
    const feed = await db.video_feeds.findUnique({ where: { video_id: v.id } });
    if (feed) return feed.group_id;
  }
  return null;
}

export async function deleteVideoFeed(db, videoId) {
  await db.video_feeds.deleteMany({ where: { video_id: videoId } });
}
