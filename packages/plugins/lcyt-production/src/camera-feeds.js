/**
 * A camera's feed, read from prod_feeds (feeds-and-devices PR 7: the camera_key column is gone).
 *
 * A camera's feed is the first `prod_feeds` row linked to it (`device_type 'camera'`, `device_id` = camera id), in the
 * order sort_order, created_at, id. Thumbnails, live status, perception, mixer sources, the relay picker and WHIP all
 * use that key. `prod_feeds` is owned by lcyt-rtmp; lcyt-production reads it with plain Prisma calls and writes only
 * the WHIP feed that a browser camera gets on first use (ensureWhipFeed) and the unlink on camera delete.
 */

import { randomBytes, randomUUID } from 'node:crypto';

const FEED_ORDER = [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }];

/**
 * @param {object} db
 * @param {Array<string>} cameraIds
 * @returns {Promise<Map<string, string>>} camera id -> feed key of its first linked feed
 */
export async function linkedFeedKeys(db, cameraIds) {
  const ids = [...new Set(cameraIds.filter(Boolean))];
  const keys = new Map();
  if (!ids.length) return keys;
  const feeds = await db.prod_feeds.findMany({
    where: { device_type: 'camera', device_id: { in: ids } },
    orderBy: FEED_ORDER,
    select: { device_id: true, feed_key: true },
  });
  for (const f of feeds) if (!keys.has(f.device_id)) keys.set(f.device_id, f.feed_key);
  return keys;
}

/**
 * Parsed cameras (parseCamera output) with `cameraKey` set to the key of each camera's linked feed (null when none).
 * Copies; the input is not mutated.
 * @param {object} db
 * @param {Array<object>} cameras
 * @returns {Promise<Array<object>>}
 */
export async function withCameraFeedKeys(db, cameras) {
  const keys = await linkedFeedKeys(db, cameras.map((c) => c.id));
  return cameras.map((c) => ({ ...c, cameraKey: keys.get(c.id) ?? null }));
}

/**
 * The key of a camera's first linked WHIP feed, without creating one.
 * @returns {Promise<string|null>}
 */
export async function findWhipFeedKey(db, cameraId) {
  const feed = await db.prod_feeds.findFirst({
    where: { device_type: 'camera', device_id: cameraId, transport: 'whip' },
    orderBy: FEED_ORDER,
    select: { feed_key: true },
  });
  return feed ? feed.feed_key : null;
}

/**
 * The WHIP feed a browser camera (webcam/mobile) publishes to: its first linked feed with transport 'whip'. When it has
 * none (cameras created before PR 7 keep their old key through the migration, so this is for new cameras) a feed is
 * created now and linked to the camera. Needs an owner: a feed belongs to a project.
 * @param {object} db
 * @param {{ id: string, name: string, label: string|null, owner_api_key: string|null }} camera  raw prod_cameras row
 * @returns {Promise<string|null>} the feed key, or null when the camera has no owner to create it for
 */
export async function ensureWhipFeed(db, camera) {
  const existing = await findWhipFeedKey(db, camera.id);
  if (existing) return existing;
  if (!camera.owner_api_key) return null;
  const feedKey = `feed-${randomBytes(6).toString('hex')}`;
  await db.prod_feeds.create({
    data: {
      id: randomUUID(),
      owner_api_key: camera.owner_api_key,
      name: camera.label || camera.name,
      feed_key: feedKey,
      transport: 'whip',
      kind: 'camera',
      label: null,
      device_type: 'camera',
      device_id: camera.id,
      sort_order: 0,
      created_at: db.$util.sqlNow(),
    },
  });
  return feedKey;
}

/**
 * Unlink a camera's feeds when the camera is deleted (there is no foreign key to do it). The feeds stay.
 * @returns {Promise<number>} feeds unlinked
 */
export async function unlinkCameraFeeds(db, cameraId) {
  return (await db.prod_feeds.updateMany({
    where: { device_type: 'camera', device_id: cameraId },
    data: { device_type: null, device_id: null },
  })).count;
}
