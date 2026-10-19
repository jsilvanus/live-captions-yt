/**
 * prod_feeds — named incoming feeds of a project (plan: feeds-and-devices, PR 1).
 *
 * A feed is a MediaMTX path a broadcaster pushes to (`transport` rtmp or whip). `kind` is generic, camera or
 * dsk; `label` is free text for generic feeds. A feed may be linked to a camera, mixer or encoder
 * (`device_type` + `device_id`, no foreign key — checked here); a device may have several feeds.
 *
 * prod_cameras / prod_mixers / prod_encoders belong to lcyt-production; like db/relay.js this module reads them
 * with plain Prisma calls rather than importing that plugin.
 */

import { randomBytes } from 'node:crypto';
import logger from 'lcyt/logger';

export const FEED_KINDS = ['generic', 'camera', 'dsk'];
export const FEED_TRANSPORTS = ['rtmp', 'whip'];
export const DEVICE_TYPES = ['camera', 'mixer', 'encoder'];

// Same shape as rtmp-manager's SAFE_NAME_RE: the key becomes a raw MediaMTX path name.
const FEED_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** @returns {string} a fresh feed key */
export function generateFeedKey() {
  return `feed-${randomBytes(6).toString('hex')}`;
}

function toFeed(row) {
  return {
    id: row.id,
    name: row.name,
    feedKey: row.feed_key,
    transport: row.transport,
    kind: row.kind,
    label: row.label ?? null,
    deviceType: row.device_type ?? null,
    deviceId: row.device_id ?? null,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  };
}

export async function listFeeds(db, apiKey) {
  const rows = await db.prod_feeds.findMany({
    where: { owner_api_key: apiKey },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toFeed);
}

export async function getFeed(db, apiKey, id) {
  const row = await db.prod_feeds.findFirst({ where: { id, owner_api_key: apiKey } });
  return row ? toFeed(row) : null;
}

/** Feed by its MediaMTX path name, any project (the publish gate in PR 2 resolves the owner from it). */
export async function getFeedByKey(db, feedKey) {
  const row = await db.prod_feeds.findUnique({ where: { feed_key: feedKey } });
  return row ? { ...toFeed(row), ownerApiKey: row.owner_api_key } : null;
}

/** Feeds linked to one device. */
export async function listFeedsForDevice(db, deviceType, deviceId) {
  const rows = await db.prod_feeds.findMany({
    where: { device_type: deviceType, device_id: deviceId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toFeed);
}

/**
 * Validate the body of POST (full) or PATCH (partial) /feeds.
 * @returns {{ error: string }|{ value: object }}  value uses the camelCase API names; only keys present are returned
 */
export function validateFeedInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const value = {};

  if (b.name !== undefined || !partial) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 120) {
      return { error: 'name is required (1-120 characters)' };
    }
    value.name = b.name.trim();
  }
  if (b.feedKey !== undefined && b.feedKey !== null) {
    if (typeof b.feedKey !== 'string' || !FEED_KEY_RE.test(b.feedKey)) {
      return { error: 'feedKey may only contain letters, digits, _ and - (max 64)' };
    }
    value.feedKey = b.feedKey;
  }
  if (b.transport !== undefined) {
    if (!FEED_TRANSPORTS.includes(b.transport)) return { error: `transport must be one of: ${FEED_TRANSPORTS.join(', ')}` };
    value.transport = b.transport;
  }
  if (b.kind !== undefined) {
    if (!FEED_KINDS.includes(b.kind)) return { error: `kind must be one of: ${FEED_KINDS.join(', ')}` };
    value.kind = b.kind;
  }
  if (b.label !== undefined) {
    if (b.label !== null && (typeof b.label !== 'string' || b.label.trim().length > 60)) {
      return { error: 'label must be text of at most 60 characters' };
    }
    value.label = b.label === null || !b.label.trim() ? null : b.label.trim();
  }
  if (b.sortOrder !== undefined) {
    if (!Number.isInteger(b.sortOrder)) return { error: 'sortOrder must be an integer' };
    value.sortOrder = b.sortOrder;
  }
  if (b.deviceType !== undefined || b.deviceId !== undefined) {
    const t = b.deviceType ?? null;
    const i = b.deviceId ?? null;
    if (t === null && i === null) {
      value.deviceType = null;
      value.deviceId = null;
    } else {
      if (!DEVICE_TYPES.includes(t)) return { error: `deviceType must be one of: ${DEVICE_TYPES.join(', ')}` };
      if (typeof i !== 'string' || !i) return { error: 'deviceId is required with deviceType' };
      value.deviceType = t;
      value.deviceId = i;
    }
  }
  return { value };
}

/**
 * Check that a device exists and, where the table has an owner, belongs to the project.
 * (prod_encoders has no owner column, so only existence can be checked there.)
 */
export async function deviceExists(db, apiKey, deviceType, deviceId) {
  if (deviceType === 'camera') {
    const row = await db.prod_cameras.findUnique({ where: { id: deviceId }, select: { owner_api_key: true } });
    return !!row && (row.owner_api_key == null || row.owner_api_key === apiKey);
  }
  if (deviceType === 'mixer') {
    const row = await db.prod_mixers.findUnique({ where: { id: deviceId }, select: { owner_api_key: true } });
    return !!row && (row.owner_api_key == null || row.owner_api_key === apiKey);
  }
  if (deviceType === 'encoder') {
    return !!(await db.prod_encoders.findUnique({ where: { id: deviceId }, select: { id: true } }));
  }
  return false;
}

/**
 * Is this MediaMTX path name free for the project? A name is taken by another feed, by any project's API key or
 * ingest stream key, or by a camera key (unless that camera is the one this feed links to and the project owns it).
 */
export async function isFeedKeyFree(db, apiKey, feedKey, { exceptFeedId = null, linkedCameraId = null } = {}) {
  const feed = await db.prod_feeds.findUnique({ where: { feed_key: feedKey }, select: { id: true } });
  if (feed && feed.id !== exceptFeedId) return false;
  const key = await db.api_keys.findFirst({
    where: { OR: [{ key: feedKey }, { ingest_stream_key: feedKey }] },
    select: { key: true },
  });
  if (key) return false;
  const cams = await db.prod_cameras.findMany({ where: { camera_key: feedKey }, select: { id: true, owner_api_key: true } });
  return cams.every((c) => c.id === linkedCameraId && (c.owner_api_key == null || c.owner_api_key === apiKey));
}

export async function createFeed(db, apiKey, id, v) {
  await db.prod_feeds.create({
    data: {
      id,
      owner_api_key: apiKey,
      name: v.name,
      feed_key: v.feedKey,
      transport: v.transport ?? 'rtmp',
      kind: v.kind ?? 'generic',
      label: v.label ?? null,
      device_type: v.deviceType ?? null,
      device_id: v.deviceId ?? null,
      sort_order: v.sortOrder ?? 0,
      created_at: db.$util.sqlNow(),
    },
  });
  return getFeed(db, apiKey, id);
}

export async function updateFeed(db, apiKey, id, v) {
  const data = {};
  if (v.name !== undefined) data.name = v.name;
  if (v.feedKey !== undefined) data.feed_key = v.feedKey;
  if (v.transport !== undefined) data.transport = v.transport;
  if (v.kind !== undefined) data.kind = v.kind;
  if (v.label !== undefined) data.label = v.label;
  if (v.sortOrder !== undefined) data.sort_order = v.sortOrder;
  if (v.deviceType !== undefined) {
    data.device_type = v.deviceType;
    data.device_id = v.deviceId;
  }
  if (Object.keys(data).length === 0) return getFeed(db, apiKey, id);
  const res = await db.prod_feeds.updateMany({ where: { id, owner_api_key: apiKey }, data });
  return res.count > 0 ? getFeed(db, apiKey, id) : null;
}

export async function deleteFeed(db, apiKey, id) {
  return (await db.prod_feeds.deleteMany({ where: { id, owner_api_key: apiKey } })).count > 0;
}

/** Unlink the feeds of a device that is being deleted (there is no foreign key to do it). */
export async function unlinkDeviceFeeds(db, deviceType, deviceId) {
  return (await db.prod_feeds.updateMany({
    where: { device_type: deviceType, device_id: deviceId },
    data: { device_type: null, device_id: null },
  })).count;
}

/**
 * Create prod_feeds rows for the feeds that already exist as cameras and mixer outputs. Idempotent and read-only
 * on the old tables: it never changes a camera or mixer, and a device that already has a feed with the same key is
 * left alone, so it is safe to run at every start.
 *   - a camera with a camera_key and control_type rtmp/webcam/mobile and an owner → kind camera, transport rtmp|whip
 *   - a mixer with an output_key and an owner → kind generic, labelled with the mixer name, transport rtmp
 * Rows that cannot be created (no owner, or the key is already used by another feed) are counted in `skipped` and
 * logged, never thrown, so one bad row cannot stop the server from starting.
 * @returns {Promise<{ created: number, skipped: number }>}
 */
export async function backfillFeeds(db) {
  let created = 0;
  let skipped = 0;
  const skip = (what, why) => { skipped++; logger.warn(`[feeds] backfill skipped ${what}: ${why}`); };

  const cameras = await db.prod_cameras.findMany({
    where: { camera_key: { not: null }, control_type: { in: ['rtmp', 'webcam', 'mobile'] } },
    orderBy: { id: 'asc' },
  });
  for (const cam of cameras) {
    const what = `camera ${cam.id}`;
    if (!cam.owner_api_key) { skip(what, 'no owner project'); continue; }
    if (!FEED_KEY_RE.test(cam.camera_key)) { skip(what, 'camera_key is not a valid feed key'); continue; }
    try {
      const linked = await db.prod_feeds.findFirst({ where: { device_type: 'camera', device_id: cam.id, feed_key: cam.camera_key } });
      if (linked) continue;
      if (await db.prod_feeds.findUnique({ where: { feed_key: cam.camera_key }, select: { id: true } })) {
        skip(what, `feed key '${cam.camera_key}' is already used by another feed`);
        continue;
      }
      await createFeed(db, cam.owner_api_key, `feed-cam-${cam.id}`, {
        name: cam.label || cam.name,
        feedKey: cam.camera_key,
        transport: cam.control_type === 'rtmp' ? 'rtmp' : 'whip',
        kind: 'camera',
        deviceType: 'camera',
        deviceId: cam.id,
        sortOrder: cam.sort_order ?? 0,
      });
      created++;
    } catch (err) {
      skip(what, err.message);
    }
  }

  const mixers = await db.prod_mixers.findMany({ where: { output_key: { not: null } }, orderBy: { id: 'asc' } });
  for (const mixer of mixers) {
    const what = `mixer ${mixer.id}`;
    if (!mixer.owner_api_key) { skip(what, 'no owner project'); continue; }
    if (!FEED_KEY_RE.test(mixer.output_key)) { skip(what, 'output_key is not a valid feed key'); continue; }
    try {
      const linked = await db.prod_feeds.findFirst({ where: { device_type: 'mixer', device_id: mixer.id, feed_key: mixer.output_key } });
      if (linked) continue;
      if (await db.prod_feeds.findUnique({ where: { feed_key: mixer.output_key }, select: { id: true } })) {
        skip(what, `feed key '${mixer.output_key}' is already used by another feed`);
        continue;
      }
      await createFeed(db, mixer.owner_api_key, `feed-mix-${mixer.id}`, {
        name: mixer.name,
        feedKey: mixer.output_key,
        transport: 'rtmp',
        kind: 'generic',
        label: mixer.name,
        deviceType: 'mixer',
        deviceId: mixer.id,
      });
      created++;
    } catch (err) {
      skip(what, err.message);
    }
  }

  if (created || skipped) logger.info(`[feeds] backfill: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}
