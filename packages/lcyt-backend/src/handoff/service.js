import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import logger from 'lcyt/logger';
import { createLocalObjectStore, shiftVttContent } from 'lcyt-files';
import { getVideo, getVideoStorageDir, getVideosStorageRoot } from '../db/videos.js';
import { listGroupFeeds, findGroupForBroadcast } from '../db/video-feeds.js';
import { getHandoff, getHandoffById, upsertHandoff, markHandoffSent, markHandoffFailed } from '../db/handoffs.js';
import { getBroadcast } from '../db/broadcasts.js';
import { runFfmpeg, probeVideo } from '../recording/recorder.js';
import { buildManifest, validateManifest, resolveManifestRefs } from './manifest.js';
import { signHandoffToken, verifyHandoffToken } from './tokens.js';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Beyond this the recorded wall-clock times cannot be trusted (wrong MEDIAMTX_RECORD_TZ, clock jump).
const MAX_LEAD_MS = 120_000;

function safeName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
}

/**
 * Hand a finished broadcast to an editor: remux each recorded feed to MP4 (stream copy), align the
 * captions and the DSK change log to the clean feed, write a manifest, and (optionally) tell the
 * editor to fetch it. Files live in the recordings store (S3) or a local directory.
 */
export function createHandoffService({ db, recordingsStore = null, resolveStorage = null, jwtSecret, settings = null, env = process.env, fetchImpl = globalThis.fetch }) {
  const files = recordingsStore ?? createLocalObjectStore({ baseDir: join(getVideosStorageRoot(), 'handoff-files') });
  const keyFor = (groupId, name) => `handoff/${groupId}/${name}`;

  const cfg = {
    url: () => String(env.SAARNAVIDEO_URL || '').trim().replace(/\/$/, ''),
    token: () => String(env.SAARNAVIDEO_TOKEN || '').trim(),
    auto: () => env.HANDOFF_AUTO_SEND === '1' || env.HANDOFF_AUTO_SEND === 'true',
    publicUrl: () => String((settings && settings.get?.('app.public_url')) || env.PUBLIC_URL || '').trim().replace(/\/$/, ''),
  };

  /** Local directory holding a video's HLS VOD (downloaded first when it lives in S3). */
  async function materializeVod(apiKey, video, workDir) {
    if (video.storageType === 's3' && recordingsStore) {
      const prefix = video.storageKey || `videos/${video.id}`;
      const dir = join(workDir, `vod-${video.id}`);
      mkdirSync(dir, { recursive: true });
      let cursor = null;
      do {
        const page = await recordingsStore.list(`${prefix}/`, { cursor });
        for (const item of page.items) {
          const rel = item.key.slice(prefix.length + 1);
          if (!rel || rel.includes('..')) continue;
          const opened = await recordingsStore.stream(item.key);
          const src = opened.stream?.pipe ? opened.stream : Readable.fromWeb(opened.stream);
          await pipeline(src, createWriteStream(join(dir, basename(rel))));
        }
        cursor = page.nextCursor;
      } while (cursor);
      return dir;
    }
    return getVideoStorageDir(apiKey, video.id);
  }

  async function remuxPart(vodDir, part, whole, outFile) {
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    if (!whole) args.push('-ss', String(part.playlistStartMs / 1000), '-t', String(part.durationMs / 1000));
    args.push('-i', join(vodDir, 'playlist.m3u8'), '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', outFile);
    await runFfmpeg(args, 'handoff-remux');
  }

  async function readCaptions(apiKey, broadcastId, shiftMs) {
    if (!broadcastId || !resolveStorage) return [];
    const rows = await db.caption_files.findMany({ where: { api_key: apiKey, broadcast_id: broadcastId, format: 'vtt', type: 'captions' } });
    const out = [];
    for (const row of rows) {
      try {
        const storage = await resolveStorage(apiKey);
        const { stream } = await storage.openRead(apiKey, row.filename, row.format);
        const chunks = [];
        for await (const c of stream) chunks.push(Buffer.from(c));
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.includes('-->')) continue;
        out.push({ language: row.lang || 'und', text: shiftMs ? shiftVttContent(text, shiftMs) : text });
      } catch (err) {
        logger.warn(`[handoff] caption file ${row.id} unreadable: ${err?.message}`);
      }
    }
    return out;
  }

  /**
   * Build (or rebuild) the handoff of a feed group. Throws an Error with `.status` for caller
   * mistakes (unknown group, recording still processing).
   */
  async function check(apiKey, { groupId = null, broadcastId = null }) {
    const gid = groupId || (broadcastId ? await findGroupForBroadcast(db, apiKey, broadcastId) : null);
    if (!gid) throw Object.assign(new Error('No recording found for this broadcast'), { status: 404 });
    const feeds = await listGroupFeeds(db, apiKey, gid);
    const clean = feeds.find((f) => f.role === 'clean');
    if (!clean) throw Object.assign(new Error('No clean recording in this group'), { status: 404 });
    const videos = new Map();
    for (const f of feeds) videos.set(f.role, await getVideo(db, apiKey, f.videoId));
    if ([...videos.values()].some((v) => !v || v.status !== 'completed')) {
      throw Object.assign(new Error('Recording is not finished yet'), { status: 409 });
    }
    return { gid, feeds, clean, videos };
  }

  async function build(apiKey, opts) {
    const { gid, feeds, clean, videos } = await check(apiKey, opts);
    const bId = videos.get('clean').broadcastId;
    await upsertHandoff(db, apiKey, gid, { broadcastId: bId, status: 'building', manifest: null });

    const workDir = mkdtempSync(join(tmpdir(), 'lcyt-handoff-'));
    try {
      const t0 = clean.meta.firstSegmentWallMs;
      const startedMs = Date.parse(clean.meta.startedAt ?? videos.get('clean').startedAt);
      let leadMs = Number.isFinite(t0) && Number.isFinite(startedMs) ? t0 - startedMs : 0;
      let timeAlignment = 'recorded';
      if (Math.abs(leadMs) > MAX_LEAD_MS) { leadMs = 0; timeAlignment = 'approximate'; }

      const manifestFeeds = [];
      for (const feed of feeds) {
        const video = videos.get(feed.role);
        const parts = feed.meta.parts?.length ? feed.meta.parts : [{ startMs: 0, playlistStartMs: 0, durationMs: video.durationMs ?? 0 }];
        const vodDir = await materializeVod(apiKey, video, workDir);
        if (!existsSync(join(vodDir, 'playlist.m3u8'))) throw new Error(`${feed.role} recording has no playable VOD`);
        const outParts = [];
        let info = null;
        for (const [i, part] of parts.entries()) {
          const name = `${feed.role}-${i + 1}.mp4`;
          const outFile = join(workDir, name);
          await remuxPart(vodDir, part, parts.length === 1, outFile);
          info = info ?? await probeVideo(outFile);
          await files.putFile(keyFor(gid, name), outFile, { contentType: 'video/mp4' });
          rmSync(outFile, { force: true });
          const feedOffset = feed.role === 'clean' ? 0 : Math.round((feed.meta.firstSegmentWallMs ?? t0) - t0);
          outParts.push({ ref: name, startMs: Math.max(0, (timeAlignment === 'approximate' && feed.role !== 'clean' ? 0 : feedOffset) + part.startMs), durationMs: part.durationMs });
        }
        const entry = { role: feed.role, parts: outParts, ...(info ?? {}), hasAlpha: false };
        if (feed.role === 'dsk') entry.key = feed.meta.chromaKey ?? null;
        manifestFeeds.push(entry);
      }
      // No composite ran: the program was the clean feed.
      if (!manifestFeeds.some((f) => f.role === 'program')) manifestFeeds.push({ role: 'program', aliasOf: 'clean' });

      // Captions are timed from the session start; move them onto the clean feed's clock.
      const sess = bId ? await db.session_stats.findFirst({ where: { api_key: apiKey, broadcast_id: bId }, orderBy: { started_at: 'asc' } }) : null;
      const sessionStartMs = sess ? Date.parse(String(sess.started_at).includes('T') ? sess.started_at : `${sess.started_at.replace(' ', 'T')}Z`) : startedMs;
      const captionShift = Number.isFinite(sessionStartMs) && Number.isFinite(startedMs) ? (sessionStartMs - startedMs) - leadMs : 0;
      const captions = [];
      for (const c of await readCaptions(apiKey, bId, captionShift)) {
        const name = `captions.${safeName(c.language)}.vtt`;
        await files.put(keyFor(gid, name), c.text, { contentType: 'text/vtt; charset=utf-8' });
        captions.push({ language: c.language, format: 'vtt', ref: name, alignedTo: 'clean' });
      }

      let dskEvents = null;
      if (clean.meta.dskEvents?.length) {
        const events = clean.meta.dskEvents.map((e) => ({ ...e, atMs: Math.max(0, Math.round(e.atMs - leadMs)) }));
        await files.put(keyFor(gid, 'dsk-events.json'), JSON.stringify({ version: 1, events }), { contentType: 'application/json' });
        dskEvents = { ref: 'dsk-events.json', count: events.length };
      }

      const broadcast = bId ? await getBroadcast(db, apiKey, bId) : null;
      const variables = {};
      if (broadcast?.title) variables.title = broadcast.title;
      const date = (videos.get('clean').startedAt || '').slice(0, 10);
      if (date) variables.date = date;

      const manifest = buildManifest({
        origin: { system: 'lcyt', instance: String(env.INSTANCE_URL || '') || null, broadcastId: bId, videoId: clean.videoId, groupId: gid },
        title: broadcast?.title || videos.get('clean').title || 'Broadcast',
        startedAt: videos.get('clean').startedAt,
        endedAt: videos.get('clean').endedAt,
        feeds: manifestFeeds, captions, dskEvents, markers: [], variables, timeAlignment,
      });
      const problems = validateManifest(manifest, { forbidden: [apiKey] });
      if (problems.length) throw new Error(`invalid manifest: ${problems.join('; ')}`);
      return await upsertHandoff(db, apiKey, gid, { broadcastId: bId, status: 'ready', manifest });
    } catch (err) {
      logger.warn(`[handoff] build failed for ${gid}: ${err?.message}`);
      await upsertHandoff(db, apiKey, gid, { broadcastId: bId, status: 'failed', manifest: null, error: String(err?.message || err).slice(0, 500) });
      throw err;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  function tokenFor(groupId, nowMs = Date.now()) {
    return signHandoffToken(jwtSecret, groupId, nowMs + TOKEN_TTL_MS);
  }

  /** Manifest with downloadable URLs. `base` is the public URL of this API (…/api/v1). */
  function servedManifest(handoff, base, token = tokenFor(handoff.id)) {
    return resolveManifestRefs(handoff.manifest, (name) => `${base}/handoff/${handoff.id}/files/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`);
  }

  function manifestUrl(groupId, base, token = tokenFor(groupId)) {
    return `${base}/handoff/${groupId}/manifest.json?token=${encodeURIComponent(token)}`;
  }

  /** Open one file of a handoff (for the download route). Returns { stream, size, contentType } or null. */
  async function openFile(groupId, name) {
    if (!/^[a-z0-9._-]+$/i.test(name)) return null;
    try {
      const opened = await files.stream(keyFor(groupId, name));
      const stream = opened.stream?.pipe ? opened.stream : Readable.fromWeb(opened.stream);
      return { stream, size: opened.contentLength ?? null, contentType: opened.contentType || 'application/octet-stream' };
    } catch { return null; }
  }

  /** Short-lived direct download URL when the store can presign (S3); null otherwise. */
  async function redirectUrl(groupId, name) {
    if (typeof files.presign !== 'function' || !/^[a-z0-9._-]+$/i.test(name)) return null;
    try { return await files.presign(keyFor(groupId, name), { expiresSeconds: 3600 }); } catch { return null; }
  }

  /** Tell the configured Saarnavideo to import this handoff. */
  async function send(apiKey, groupId) {
    const handoff = await getHandoff(db, apiKey, groupId);
    if (!handoff || handoff.status === 'building') throw Object.assign(new Error('Handoff is not ready'), { status: 409 });
    if (!handoff.manifest) throw Object.assign(new Error('Handoff has no manifest'), { status: 409 });
    const target = cfg.url();
    const base = cfg.publicUrl();
    if (!target) throw Object.assign(new Error('SAARNAVIDEO_URL is not configured'), { status: 503 });
    if (!base) throw Object.assign(new Error('PUBLIC_URL is not configured'), { status: 503 });
    const apiBase = `${base}/api/v1`;
    try {
      const res = await fetchImpl(`${target}/api/imports/lcyt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.token() ? { Authorization: `Bearer ${cfg.token()}` } : {}) },
        body: JSON.stringify({ manifestUrl: manifestUrl(groupId, apiBase) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Saarnavideo answered ${res.status}`);
      await markHandoffSent(db, apiKey, groupId);
      return getHandoff(db, apiKey, groupId);
    } catch (err) {
      await markHandoffFailed(db, apiKey, groupId, err?.message || err);
      throw Object.assign(new Error(`Could not deliver to Saarnavideo: ${err?.message}`), { status: 502 });
    }
  }

  /** Called when a recording group is finalized; builds and sends when HANDOFF_AUTO_SEND is on. */
  async function onRecordingFinalized({ apiKey, groupId, results }) {
    if (!cfg.auto() || !cfg.url()) return;
    if (!results.some((r) => r.ok && !r.empty)) return;
    try {
      await build(apiKey, { groupId });
      await send(apiKey, groupId);
    } catch (err) {
      logger.warn(`[handoff] automatic handoff failed for ${groupId}: ${err?.message}`);
    }
  }

  return { check, build, send, servedManifest, manifestUrl, tokenFor, verifyToken: (g, t) => verifyHandoffToken(jwtSecret, g, t), openFile, redirectUrl, onRecordingFinalized, getHandoffById: (id) => getHandoffById(db, id), publicUrl: cfg.publicUrl };
}
