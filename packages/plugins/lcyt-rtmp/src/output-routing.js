/**
 * Which MediaMTX path a relay slot that sends an output (`rtmp_relays.source_output_id`) fans out
 * (plan_egress_outputs.md PR 4).
 *
 * An output's final picture is its crop, else its DSK step, else the picture it reads (its feed, or the final picture of the
 * output it is built on). The route says how the relay manager should treat the slot:
 *   - `program`: the picture is the project's main stream without a processing step. The slot behaves exactly like an old
 *     'program' slot (raw ingest, CEA-708, per-slot transcoding, the relay's own DSK composite).
 *   - `crop`:    the picture is the project's default crop (`{apiKey}-crop`): an old 'crop' slot.
 *   - `path`:    anything else (a step path `out-<id>-dsk` / `out-<id>-crop`, or a named feed's own path). Copy fan-out, like a
 *     feed-sourced slot. `audioPath` is set when the slot's output replaces the sound with an audio feed (`audio_source`).
 * An unknown output gives null and the slot falls back to its own `source_view`, like a deleted feed does.
 */

import { outputCropPath, outputDskPath, effectiveDskViewports, stepsActive, MAX_CROP_SOURCE_DEPTH } from './output-paths.js';

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/**
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {string} outputId
 * @param {{ get: (key: string) => any }|null} [settings]
 * `path` routes carry `programStep: true` when the path is the DSK step of a picture built on the project's main stream:
 * a slot that needs the relay's own ffmpeg (CEA-708, per-slot transcoding) keeps the old 'program' handling there (the
 * relay's composite never applied to such slots either).
 * @returns {Promise<{ kind: 'program' } | { kind: 'crop' } | { kind: 'path', path: string, audioPath: string|null, programStep?: boolean } | null>}
 */
export async function resolveOutputRoute(db, apiKey, outputId, settings = null) {
  const first = await db.outputs.findFirst({ where: { id: outputId, owner_api_key: apiKey } });
  if (!first) return null;
  const [cfg, primary] = await Promise.all([
    db.crop_config.findUnique({ where: { api_key: apiKey }, select: { output_id: true } }),
    db.api_keys.findUnique({ where: { key: apiKey }, select: { primary_feed_id: true } }),
  ]);
  const defaultCropId = cfg?.output_id ?? null;

  let final = null; // { path, dskStepOf? } | { program: true }
  let cursor = first;
  for (let i = 0; i < MAX_CROP_SOURCE_DEPTH && cursor && !final; i++) {
    if (cursor.crop_enabled === 1) {
      final = { path: outputCropPath(apiKey, cursor.id, cursor.id === defaultCropId) };
    } else if (cursor.enabled !== 0 && stepsActive(settings) && (await effectiveDskViewports(db, apiKey, parseJson(cursor.dsk_json, []), settings)).length) {
      final = { path: outputDskPath(cursor.id), dskStepOf: cursor };
    } else if (cursor.source_type === 'feed') {
      const feed = await db.prod_feeds.findFirst({ where: { id: cursor.source_id, owner_api_key: apiKey }, select: { id: true, feed_key: true } });
      if (!feed) return null;
      final = feed.id === primary?.primary_feed_id ? { program: true } : { path: feed.feed_key };
    } else {
      cursor = await db.outputs.findFirst({ where: { id: cursor.source_id, owner_api_key: apiKey } });
    }
  }
  if (!final) return null;
  if (final.program) return { kind: 'program' };
  if (final.path === `${apiKey}-crop`) return { kind: 'crop' };

  let audioPath = null;
  const audio = parseJson(first.audio_source, 'source');
  if (audio && typeof audio === 'object' && typeof audio.feed === 'string') {
    const feed = await db.prod_feeds.findFirst({ where: { id: audio.feed, owner_api_key: apiKey }, select: { feed_key: true, media: true } });
    if (feed && feed.media !== 'video') audioPath = feed.feed_key;
  }
  let programStep = false;
  if (final.dskStepOf) {
    let c = final.dskStepOf;
    for (let i = 0; i < MAX_CROP_SOURCE_DEPTH && c; i++) {
      if (c.source_type === 'feed') { programStep = c.source_id === primary?.primary_feed_id; break; }
      c = await db.outputs.findFirst({ where: { id: c.source_id, owner_api_key: apiKey } });
    }
  }
  return { kind: 'path', path: final.path, audioPath, ...(programStep ? { programStep: true } : {}) };
}
