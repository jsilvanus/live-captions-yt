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
 * Is this MediaMTX path name free? A name is taken by another feed or by any project's API key or ingest stream key.
 */
export async function isFeedKeyFree(db, feedKey, { exceptFeedId = null } = {}) {
  const feed = await db.prod_feeds.findUnique({ where: { feed_key: feedKey }, select: { id: true } });
  if (feed && feed.id !== exceptFeedId) return false;
  const key = await db.api_keys.findFirst({
    where: { OR: [{ key: feedKey }, { ingest_stream_key: feedKey }] },
    select: { key: true },
  });
  return !key;
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
 * Does a column still exist? The legacy columns (prod_cameras.camera_key, rtmp_relays.source_camera_id) are only present
 * on databases created before feeds-and-devices PR 7; PostgreSQL drops them in migration 0008.
 */
async function hasColumn(db, table, column) {
  if (db.$dialect === 'postgres') {
    const rows = await db.$queryRawUnsafe(
      'SELECT 1 AS found FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2',
      table, column);
    return rows.length > 0;
  }
  const rows = await db.$queryRawUnsafe(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`, column);
  return rows.length > 0;
}

/**
 * Feeds-and-devices PR 7: move the legacy camera keys into prod_feeds and drop the columns that held them.
 * Idempotent, and a no-op once the columns are gone. Runs at every start, before the server takes requests.
 *   - every prod_cameras.camera_key with an owner and a valid key gets a camera feed (same key, linked to the camera):
 *     transport whip for webcam/mobile cameras, rtmp otherwise; a key that already has a feed is left alone
 *   - control_type 'rtmp' becomes 'none' (the rtmp type is gone; such a camera is a device with a linked feed)
 *   - rtmp_relays.source_camera_id is copied to source_feed_id: the camera's first feed (same order as linkedFeedKeys)
 *   - a column is dropped only when nothing in it is left without a feed; otherwise it stays (the code no longer reads
 *     it) and a warning names the rows, so no key is lost. Ownerless cameras and clashing keys are the usual cause.
 * Rows that cannot be migrated are counted in `skipped` and logged, never thrown.
 * @returns {Promise<{ created: number, skipped: number, dropped: string[] }>}
 */
export async function backfillFeeds(db) {
  let created = 0;
  let skipped = 0;
  const dropped = [];
  let camerasKept = 0;
  const skip = (what, why) => { skipped++; logger.warn(`[feeds] backfill skipped ${what}: ${why}`); };

  const hasCameraKey = await hasColumn(db, 'prod_cameras', 'camera_key');
  if (hasCameraKey) {
    const cameras = await db.$queryRawUnsafe(
      "SELECT id, name, label, control_type, owner_api_key, sort_order, camera_key FROM prod_cameras WHERE camera_key IS NOT NULL AND camera_key <> '' ORDER BY id");
    for (const cam of cameras) {
      const what = `camera ${cam.id}`;
      const keep = () => { camerasKept++; };
      if (!cam.owner_api_key) { skip(what, 'no owner project'); keep(); continue; }
      if (!FEED_KEY_RE.test(cam.camera_key)) { skip(what, 'camera_key is not a valid feed key'); keep(); continue; }
      try {
        const linked = await db.prod_feeds.findFirst({ where: { device_type: 'camera', device_id: cam.id, feed_key: cam.camera_key } });
        if (linked) continue;
        if (await db.prod_feeds.findUnique({ where: { feed_key: cam.camera_key }, select: { id: true } })) {
          skip(what, `feed key '${cam.camera_key}' is already used by another feed`);
          keep();
          continue;
        }
        const browser = cam.control_type === 'webcam' || cam.control_type === 'mobile';
        await createFeed(db, cam.owner_api_key, `feed-cam-${cam.id}`, {
          name: cam.label || cam.name,
          feedKey: cam.camera_key,
          transport: browser ? 'whip' : 'rtmp',
          kind: 'camera',
          deviceType: 'camera',
          deviceId: cam.id,
          sortOrder: Number(cam.sort_order ?? 0),
        });
        created++;
      } catch (err) {
        skip(what, err.message);
        keep();
      }
    }
  }
  // The rtmp control type is gone whatever happened to its key: an unknown type would stop the camera registry.
  await db.$executeRawUnsafe("UPDATE prod_cameras SET control_type = 'none' WHERE control_type = 'rtmp'");

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

  const hasRelaySource = await hasColumn(db, 'rtmp_relays', 'source_camera_id');
  let relaysKept = 0;
  if (hasRelaySource) {
    const relays = await db.$queryRawUnsafe(
      'SELECT id, source_camera_id FROM rtmp_relays WHERE source_camera_id IS NOT NULL AND source_feed_id IS NULL ORDER BY id');
    for (const relay of relays) {
      const feed = await db.prod_feeds.findFirst({
        where: { device_type: 'camera', device_id: relay.source_camera_id },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (feed) {
        await db.$executeRawUnsafe('UPDATE rtmp_relays SET source_feed_id = ? WHERE id = ?', feed.id, Number(relay.id));
      } else if (hasCameraKey && (await db.$queryRawUnsafe(
        "SELECT 1 AS found FROM prod_cameras WHERE id = ? AND camera_key IS NOT NULL AND camera_key <> ''", relay.source_camera_id)).length) {
        // Its camera has a key but no feed (see the camera loop above): dropping the column would lose the source.
        relaysKept++;
      }
    }
  }

  if (hasRelaySource && relaysKept === 0) {
    await db.$executeRawUnsafe('ALTER TABLE rtmp_relays DROP COLUMN source_camera_id');
    dropped.push('rtmp_relays.source_camera_id');
  } else if (hasRelaySource) {
    logger.warn(`[feeds] backfill kept rtmp_relays.source_camera_id: ${relaysKept} relay(s) point at a camera without a feed`);
  }
  if (hasCameraKey && camerasKept === 0) {
    await db.$executeRawUnsafe('ALTER TABLE prod_cameras DROP COLUMN camera_key');
    dropped.push('prod_cameras.camera_key');
  } else if (hasCameraKey) {
    logger.warn('[feeds] backfill kept prod_cameras.camera_key: some camera keys have no feed (see the skipped lines above)');
  }

  if (created || skipped || dropped.length) {
    logger.info(`[feeds] backfill: ${created} created, ${skipped} skipped${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
  }
  return { created, skipped, dropped };
}

// ─── Primary feed (feeds-and-devices PR 8) ────────────────────────────────────

/** Name and label a project's primary feed gets when it is first created from the old ingest key. */
export const PRIMARY_FEED_NAME = 'Main video';
export const PRIMARY_FEED_LABEL = 'main';

/**
 * The MediaMTX path name of the project's main incoming stream: the primary feed's key, or — for a project that has
 * none yet — what it always was, the rotated `ingest_stream_key` or else the api key itself.
 * @returns {Promise<string>}
 */
export async function getPrimaryFeedKey(db, apiKey) {
  const row = await db.api_keys.findUnique({
    where: { key: apiKey },
    select: { primary_feed_id: true, ingest_stream_key: true },
  });
  if (!row) return apiKey;
  if (row.primary_feed_id) {
    const feed = await db.prod_feeds.findFirst({
      where: { id: row.primary_feed_id, owner_api_key: apiKey },
      select: { feed_key: true },
    });
    if (feed) return feed.feed_key;
  }
  return row.ingest_stream_key || apiKey;
}

/** The primary feed row's id, or null when the project has none (yet). */
export async function getPrimaryFeedId(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { primary_feed_id: true } });
  if (!row?.primary_feed_id) return null;
  const feed = await db.prod_feeds.findFirst({ where: { id: row.primary_feed_id, owner_api_key: apiKey }, select: { id: true } });
  return feed ? feed.id : null;
}

/**
 * Make sure the project has a primary feed: an ordinary prod_feeds row carrying the key the project's main stream
 * already uses (`ingest_stream_key`, else the api key), so no publisher is reconfigured. Idempotent. Returns the
 * feed id, or null when it could not be created (the key is taken by another feed; logged).
 */
export async function ensurePrimaryFeed(db, apiKey, { force = false, publishing = false } = {}) {
  const row = await db.api_keys.findUnique({
    where: { key: apiKey },
    select: { primary_feed_id: true, ingest_stream_key: true, relay_allowed: true },
  });
  if (!row) return null;
  const existing = await getPrimaryFeedId(db, apiKey);
  if (existing) return existing;
  // A project may have no incoming stream at all (browser speech-to-text, cues, camera control only), so the main
  // feed is made only for a project that uses one: its own stream key, the video relay, a publisher right now, or an explicit ask.
  if (!force && !publishing && !row.ingest_stream_key && row.relay_allowed !== 1) return null;
  const feedKey = row.ingest_stream_key || apiKey;
  const id = `feed-main-${randomBytes(6).toString('hex')}`;
  try {
    const clash = await db.prod_feeds.findUnique({ where: { feed_key: feedKey }, select: { id: true, owner_api_key: true } });
    if (clash) {
      // A feed of this project that already carries the key becomes the primary one; any other clash is left alone.
      if (clash.owner_api_key !== apiKey) { logger.warn(`[feeds] primary feed for a project not created: key '${feedKey}' is used by another project's feed`); return null; }
      await db.api_keys.updateMany({ where: { key: apiKey }, data: { primary_feed_id: clash.id } });
      return clash.id;
    }
    await db.prod_feeds.create({
      data: {
        id, owner_api_key: apiKey, name: PRIMARY_FEED_NAME, feed_key: feedKey, transport: 'rtmp', kind: 'generic',
        label: PRIMARY_FEED_LABEL, device_type: null, device_id: null, sort_order: -1, created_at: db.$util.sqlNow(),
      },
    });
    await db.api_keys.updateMany({ where: { key: apiKey }, data: { primary_feed_id: id } });
    return id;
  } catch (err) {
    logger.warn(`[feeds] primary feed for a project not created: ${err.message}`);
    return null;
  }
}

/** Create the primary feed of every project that uses a main stream and has none. @returns {Promise<number>} how many were created */
export async function backfillPrimaryFeeds(db) {
  const rows = await db.api_keys.findMany({ where: { primary_feed_id: null }, select: { key: true } });
  let created = 0;
  for (const { key } of rows) if (await ensurePrimaryFeed(db, key)) created++;
  return created;
}

/** Make a feed of the project its primary one. @returns {Promise<boolean>} false when the feed is not the project's */
export async function setPrimaryFeed(db, apiKey, feedId) {
  const feed = await db.prod_feeds.findFirst({ where: { id: feedId, owner_api_key: apiKey }, select: { id: true, transport: true } });
  if (!feed) return false;
  await db.api_keys.updateMany({ where: { key: apiKey }, data: { primary_feed_id: feed.id } });
  return true;
}

/**
 * Keep the old column in step with the primary feed's key (`ingest_stream_key`, read by code that predates feeds and
 * kept for a rollback). The api key itself is stored as NULL, as it always was.
 */
export async function syncIngestStreamKey(db, apiKey, feedKey) {
  await db.api_keys.updateMany({ where: { key: apiKey }, data: { ingest_stream_key: feedKey === apiKey ? null : feedKey } });
}

/** Which project's primary feed carries this MediaMTX path name? null when none does. */
export async function ownerOfPrimaryFeedKey(db, feedKey) {
  const feed = await db.prod_feeds.findUnique({ where: { feed_key: feedKey }, select: { id: true, owner_api_key: true } });
  if (!feed) return null;
  const owner = await db.api_keys.findFirst({ where: { key: feed.owner_api_key, primary_feed_id: feed.id }, select: { key: true } });
  return owner ? owner.key : null;
}
