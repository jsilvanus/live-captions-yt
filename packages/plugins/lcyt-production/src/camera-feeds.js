/**
 * Feeds-and-devices PR 6: where "this camera's own feed" is read from.
 *
 * A camera's feed is its own `camera_key` (older cameras, and webcam/mobile WHIP keys until PR 7) or, failing that,
 * the first `prod_feeds` row linked to it (`device_type 'camera'`, `device_id` = camera id). Every reader that used to
 * look at `camera_key` directly (perception, thumbnails, mixer sources, the cameras API) goes through here, so a feed
 * linked in the Devices card behaves exactly like a camera key. `prod_feeds` is owned by lcyt-rtmp; read-only here.
 */

/**
 * @param {object} db
 * @param {Array<string>} cameraIds
 * @returns {Promise<Map<string, string>>} camera id -> key of its first linked feed (feed order: sort_order, created_at, id)
 */
export async function linkedFeedKeys(db, cameraIds) {
  const ids = [...new Set(cameraIds.filter(Boolean))];
  const keys = new Map();
  if (!ids.length) return keys;
  const feeds = await db.prod_feeds.findMany({
    where: { device_type: 'camera', device_id: { in: ids } },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    select: { device_id: true, feed_key: true },
  });
  for (const f of feeds) if (!keys.has(f.device_id)) keys.set(f.device_id, f.feed_key);
  return keys;
}

/**
 * Raw `prod_cameras` rows with `camera_key` filled from the linked feed when the camera has none of its own.
 * The camera's own key always wins. Rows are copied, never mutated.
 * @param {object} db
 * @param {Array<object>} rows
 * @returns {Promise<Array<object>>}
 */
export async function withFeedKeys(db, rows) {
  const missing = rows.filter((r) => r && !r.camera_key).map((r) => r.id);
  if (!missing.length) return rows;
  const keys = await linkedFeedKeys(db, missing);
  return rows.map((r) => (!r || r.camera_key || !keys.has(r.id)) ? r : { ...r, camera_key: keys.get(r.id) });
}
