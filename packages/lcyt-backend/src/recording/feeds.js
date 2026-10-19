import { randomUUID } from 'node:crypto';
import logger from 'lcyt/logger';
import { programPathName, dskPathName, getPrimaryFeedKey } from 'lcyt-rtmp';
import { getCompositeChromaKey } from 'lcyt-dsk';
import { startVideoRecording, finishVideoRecording } from '../db/videos.js';
import { registerVideoFeed, listGroupFeeds, updateVideoFeedMeta, FEED_ROLES } from '../db/video-feeds.js';
import { configureMediaMtxRecording, finalizeVideoRecording } from './recorder.js';

const MAX_DSK_EVENTS = 5000;
const TITLE_SUFFIX = { clean: '', program: ' (program)', dsk: ' (graphics)' };

/** Feeds to record, from `RECORD_FEEDS` (default all three). `clean` is always recorded. */
export function configuredFeedRoles(env = process.env) {
  const raw = String(env.RECORD_FEEDS ?? 'clean,program,dsk').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const roles = new Set(raw.filter((r) => FEED_ROLES.includes(r)));
  roles.add('clean');
  return FEED_ROLES.filter((r) => roles.has(r));
}

async function pathNameFor(db, apiKey, role, settings) {
  if (role === 'program') return programPathName(apiKey);
  if (role === 'dsk') return dskPathName(apiKey, settings);
  return getPrimaryFeedKey(db, apiKey);
}

// In-memory DSK change logs of running recordings (groupId -> { events, unsubscribe, startMs }).
const dskLogs = new Map();

/** Graphics changes as `{ atMs (since recording start), kind, data }`. Text and bindings are kept; no secrets pass through here. */
function startDskLog(eventBus, apiKey, groupId, startMs) {
  if (!eventBus?.subscribe) return;
  const log = { events: [], startMs, unsubscribe: null };
  log.unsubscribe = eventBus.subscribe(apiKey, ['dsk.*'], (env) => {
    if (log.events.length >= MAX_DSK_EVENTS) return;
    log.events.push({ atMs: Math.max(0, (env.ts ?? Date.now()) - startMs), kind: String(env.topic).replace(/^dsk\./, ''), data: env.data ?? null });
  }, { remote: true });
  dskLogs.set(groupId, log);
}

function stopDskLog(groupId) {
  const log = dskLogs.get(groupId);
  if (!log) return [];
  try { log.unsubscribe?.(); } catch { /* ignore */ }
  dskLogs.delete(groupId);
  return log.events;
}

/**
 * Start recording every configured feed of a broadcast: one `videos` row and one MediaMTX path per
 * feed, tied together by a group id. A feed whose path never carries video (no DSK that day) just
 * ends up empty and is dropped when finalized.
 *
 * @returns {Promise<{ groupId: string, cleanVideoId: string|null, feeds: Record<string,string> }>}
 */
export async function startRecordingGroup(db, {
  apiKey, broadcastId = null, title = 'Recorded broadcast', startedAt = new Date().toISOString(),
  recordingsStore = null, mediamtxClient = null, settings = null, eventBus = null, roles = configuredFeedRoles(),
}) {
  const groupId = randomUUID();
  const feeds = {};
  for (const role of roles) {
    const res = await startVideoRecording(db, apiKey, {
      broadcastId,
      title: `${title}${TITLE_SUFFIX[role] ?? ''}`,
      startedAt,
      storageType: recordingsStore?.type === 's3' ? 's3' : 'local',
    });
    if (!res.ok) { logger.warn(`[recording] could not create ${role} video: ${res.error}`); continue; }
    feeds[role] = res.video.id;
    const meta = { startedAt };
    if (role === 'dsk') {
      // How the graphics feed is keyed on air, so an editor can key it out the same way.
      try { meta.chromaKey = (await getCompositeChromaKey(db, apiKey)) ?? null; } catch { meta.chromaKey = null; }
    }
    await registerVideoFeed(db, apiKey, { videoId: res.video.id, groupId, role, meta });
    await configureMediaMtxRecording(mediamtxClient, {
      pathName: await pathNameFor(db, apiKey, role, settings),
      apiKey, videoId: res.video.id, enabled: true,
    });
  }
  startDskLog(eventBus, apiKey, groupId, Date.parse(startedAt) || Date.now());
  return { groupId, cleanVideoId: feeds.clean ?? null, feeds };
}

/**
 * End a recording group: mark its videos `processing`, stop MediaMTX recording on every path, keep
 * the DSK change log, and finalize each feed after `delayMs` (so MediaMTX can flush its last
 * segment). Resolves with a promise for the finalize step so callers (and tests) can wait for it.
 */
export async function stopRecordingGroup(db, {
  apiKey, groupId, endedAt = new Date().toISOString(), durationMs = null,
  mediamtxClient = null, recordingsStore = null, settings = null, delayMs = 3000, finalizeOpts = {}, onGroupFinalized = null,
}) {
  const feeds = await listGroupFeeds(db, apiKey, groupId);
  const events = stopDskLog(groupId);
  for (const feed of feeds) {
    await finishVideoRecording(db, apiKey, feed.videoId, { status: 'processing', endedAt, durationMs });
    await configureMediaMtxRecording(mediamtxClient, {
      pathName: await pathNameFor(db, apiKey, feed.role, settings),
      apiKey, videoId: feed.videoId, enabled: false,
    });
  }
  const clean = feeds.find((f) => f.role === 'clean');
  if (clean && events.length > 0) await updateVideoFeedMeta(db, clean.videoId, { dskEvents: events });

  const finalized = new Promise((resolve) => {
    const timer = setTimeout(async () => {
      const results = [];
      for (const feed of feeds) {
        results.push(await finalizeVideoRecording(db, apiKey, feed.videoId, { recordingsStore, ...finalizeOpts }));
      }
      if (onGroupFinalized) {
        try { await onGroupFinalized({ apiKey, groupId, results }); } catch (err) { logger.warn(`[recording] group callback failed: ${err?.message}`); }
      }
      resolve(results);
    }, delayMs);
    timer.unref?.();
  });
  return { groupId, feeds: feeds.map((f) => f.videoId), finalized };
}
