/**
 * outputs — egress outputs of a project (plan_egress_outputs.md, PR 1: data model only).
 *
 * An output is a named pipeline `source -> [DSK viewports] -> [crop] -> destinations`. Its source is a prod_feeds
 * row (`source_type: 'feed'`) or another output (`'output'`); the ids are not foreign keys, they are checked here.
 * Nothing reads outputs yet: processing steps, crop per output and relay slots come in the next PRs, so this module
 * and `backfillOutputs` change no behaviour.
 */

import { randomBytes } from 'node:crypto';
import logger from 'lcyt/logger';

export const OUTPUT_SOURCE_TYPES = ['feed', 'output'];
/** At most this many outputs in one chain, the one being written included (Vertical on Program on a feed is 2). */
export const MAX_OUTPUT_CHAIN_DEPTH = 3;
export const PROGRAM_OUTPUT_NAME = 'Program';
export const VERTICAL_OUTPUT_NAME = 'Vertical';

export function generateOutputId() {
  return `out-${randomBytes(6).toString('hex')}`;
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function toOutput(row) {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    sourceId: row.source_id ?? null,
    dsk: parseJson(row.dsk_json, []),
    cropEnabled: row.crop_enabled === 1,
    audioSource: parseJson(row.audio_source, 'source'),
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  };
}

export async function listOutputs(db, apiKey) {
  const rows = await db.outputs.findMany({
    where: { owner_api_key: apiKey },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toOutput);
}

export async function getOutput(db, apiKey, id) {
  const row = await db.outputs.findFirst({ where: { id, owner_api_key: apiKey } });
  return row ? toOutput(row) : null;
}

/**
 * Validate a create (or, with `partial`, update) body. audioSource is `'source'` or `{ feed: '<id>' }`.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateOutputInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const v = {};
  if (b.name !== undefined || !partial) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 80) return { ok: false, error: 'name must be 1-80 characters' };
    v.name = b.name.trim();
  }
  if (b.sourceType !== undefined || !partial) {
    if (!OUTPUT_SOURCE_TYPES.includes(b.sourceType)) return { ok: false, error: `sourceType must be one of: ${OUTPUT_SOURCE_TYPES.join(', ')}` };
    v.sourceType = b.sourceType;
  }
  if (b.sourceId !== undefined || !partial) {
    if (typeof b.sourceId !== 'string' || !b.sourceId) return { ok: false, error: 'sourceId is required' };
    v.sourceId = b.sourceId;
  }
  if (b.dsk !== undefined) {
    if (!Array.isArray(b.dsk) || b.dsk.some(n => typeof n !== 'string' || !n) || new Set(b.dsk).size !== b.dsk.length) {
      return { ok: false, error: 'dsk must be a list of distinct viewport names' };
    }
    v.dsk = b.dsk;
  }
  if (b.cropEnabled !== undefined) v.cropEnabled = Boolean(b.cropEnabled);
  if (b.enabled !== undefined) v.enabled = Boolean(b.enabled);
  if (b.sortOrder !== undefined) {
    if (!Number.isInteger(b.sortOrder)) return { ok: false, error: 'sortOrder must be an integer' };
    v.sortOrder = b.sortOrder;
  }
  if (b.audioSource !== undefined) {
    const a = b.audioSource;
    const ok = a === 'source' || (a && typeof a === 'object' && typeof a.feed === 'string' && a.feed);
    if (!ok) return { ok: false, error: "audioSource must be 'source' or { feed: '<feed id>' }" };
    v.audioSource = a === 'source' ? 'source' : { feed: a.feed };
  }
  return { ok: true, value: v };
}

/**
 * Check that an output's source exists in the project and does not make a cycle or an over-deep chain.
 * `selfId` is the output being written (null for a new one).
 * @returns {Promise<string|null>} an error message, or null when the source is fine
 */
export async function checkOutputSource(db, apiKey, selfId, sourceType, sourceId) {
  if (sourceType === 'feed') {
    const feed = await db.prod_feeds.findFirst({ where: { id: sourceId, owner_api_key: apiKey }, select: { id: true } });
    return feed ? null : 'sourceId is not a feed of this project';
  }
  // Walk the chain upwards from the proposed source: it must reach a feed, never selfId, within the depth cap.
  let depth = 1; // the output being written
  let cursor = sourceId;
  const seen = new Set();
  while (true) {
    if (cursor === selfId || seen.has(cursor)) return 'the source chain would loop back to this output';
    seen.add(cursor);
    const row = await db.outputs.findFirst({ where: { id: cursor, owner_api_key: apiKey }, select: { source_type: true, source_id: true } });
    if (!row) return 'sourceId is not an output of this project';
    if (++depth > MAX_OUTPUT_CHAIN_DEPTH) return `outputs may be chained at most ${MAX_OUTPUT_CHAIN_DEPTH} deep`;
    if (row.source_type === 'feed') return null;
    cursor = row.source_id;
  }
}

/** Create an output. @returns {Promise<{ ok: true, output: object } | { ok: false, error: string, status: number }>} */
export async function createOutput(db, apiKey, body) {
  const checked = validateOutputInput(body);
  if (!checked.ok) return { ...checked, status: 400 };
  const v = checked.value;
  const sourceError = await checkOutputSource(db, apiKey, null, v.sourceType, v.sourceId);
  if (sourceError) return { ok: false, error: sourceError, status: 400 };
  const clash = await db.outputs.findFirst({ where: { owner_api_key: apiKey, name: v.name }, select: { id: true } });
  if (clash) return { ok: false, error: 'an output with this name already exists', status: 409 };
  const id = generateOutputId();
  await db.outputs.create({
    data: {
      id, owner_api_key: apiKey, name: v.name, source_type: v.sourceType, source_id: v.sourceId,
      dsk_json: JSON.stringify(v.dsk ?? []), crop_enabled: v.cropEnabled ? 1 : 0,
      audio_source: JSON.stringify(v.audioSource ?? 'source'), enabled: v.enabled === false ? 0 : 1,
      sort_order: v.sortOrder ?? 0, created_at: db.$util.sqlNow(),
    },
  });
  return { ok: true, output: await getOutput(db, apiKey, id) };
}

/** Update an output. Only provided fields change. */
export async function updateOutput(db, apiKey, id, body) {
  const existing = await getOutput(db, apiKey, id);
  if (!existing) return { ok: false, error: 'output not found', status: 404 };
  const checked = validateOutputInput(body, { partial: true });
  if (!checked.ok) return { ...checked, status: 400 };
  const v = checked.value;
  if (v.sourceType !== undefined || v.sourceId !== undefined) {
    const sourceError = await checkOutputSource(db, apiKey, id, v.sourceType ?? existing.sourceType, v.sourceId ?? existing.sourceId);
    if (sourceError) return { ok: false, error: sourceError, status: 400 };
  }
  if (v.name !== undefined && v.name !== existing.name) {
    const clash = await db.outputs.findFirst({ where: { owner_api_key: apiKey, name: v.name }, select: { id: true } });
    if (clash) return { ok: false, error: 'an output with this name already exists', status: 409 };
  }
  const data = {};
  if (v.name !== undefined) data.name = v.name;
  if (v.sourceType !== undefined) data.source_type = v.sourceType;
  if (v.sourceId !== undefined) data.source_id = v.sourceId;
  if (v.dsk !== undefined) data.dsk_json = JSON.stringify(v.dsk);
  if (v.cropEnabled !== undefined) data.crop_enabled = v.cropEnabled ? 1 : 0;
  if (v.audioSource !== undefined) data.audio_source = JSON.stringify(v.audioSource);
  if (v.enabled !== undefined) data.enabled = v.enabled ? 1 : 0;
  if (v.sortOrder !== undefined) data.sort_order = v.sortOrder;
  if (Object.keys(data).length) await db.outputs.updateMany({ where: { id, owner_api_key: apiKey }, data });
  return { ok: true, output: await getOutput(db, apiKey, id) };
}

/**
 * Delete an output. Refused while another output is built on it or a relay slot sends it out.
 * Its crop settings go with it; legacy crop rows that were tagged with its id are untagged, not deleted.
 */
export async function deleteOutput(db, apiKey, id) {
  const existing = await getOutput(db, apiKey, id);
  if (!existing) return { ok: false, error: 'output not found', status: 404 };
  const child = await db.outputs.findFirst({ where: { owner_api_key: apiKey, source_type: 'output', source_id: id }, select: { name: true } });
  if (child) return { ok: false, error: `output '${child.name}' is built on this output`, status: 409 };
  const slot = await db.rtmp_relays.findFirst({ where: { api_key: apiKey, source_output_id: id }, select: { slot: true } });
  if (slot) return { ok: false, error: `relay slot ${slot.slot} sends this output`, status: 409 };
  await db.output_crop_config.deleteMany({ where: { output_id: id } });
  for (const table of ['crop_preset_sets', 'crop_presets', 'crop_source_map']) {
    await db[table].updateMany({ where: { api_key: apiKey, output_id: id }, data: { output_id: null } });
  }
  await db.outputs.deleteMany({ where: { id, owner_api_key: apiKey } });
  return { ok: true };
}

/** Name of the project's composite DSK viewport (display_settings.stream.mode === 'composite'), or null. */
async function compositeViewportName(db, apiKey) {
  const rows = await db.dsk_viewports.findMany({ where: { api_key: apiKey }, select: { name: true, display_settings_json: true } });
  for (const r of rows) {
    const settings = parseJson(r.display_settings_json || 'null', null);
    if (settings?.stream?.mode === 'composite') return r.name;
  }
  return null;
}

async function projectHasCrop(db, apiKey) {
  const cfg = await db.crop_config.findUnique({ where: { api_key: apiKey } });
  if (cfg?.enabled === 1) return true;
  if (await db.crop_preset_sets.findFirst({ where: { api_key: apiKey }, select: { id: true } })) return true;
  return Boolean(await db.crop_presets.findFirst({ where: { api_key: apiKey }, select: { id: true } }));
}

/**
 * Create one project's default outputs from what it already has. Idempotent: a project that has any output is left alone.
 *  - "Program": source = the primary feed, `dsk` = the legacy composite viewport (if any). Only for a project with a primary feed.
 *  - "Vertical": source = Program, crop on when the old crop is enabled; only for a project that has crop settings.
 *    The legacy crop_config row is copied to output_crop_config, and the project's crop sets, presets and source map are
 *    tagged with the Vertical output id in place (no copy, so the (api_key, name) unique indexes cannot clash).
 *  - relay slots with source_view 'program' / 'crop' get source_output_id Program / Vertical. source_view stays (rollback).
 * @returns {Promise<{ program: string|null, vertical: string|null }>} the ids created (null = not created)
 */
export async function ensureProjectOutputs(db, apiKey) {
  const result = { program: null, vertical: null };
  if (await db.outputs.findFirst({ where: { owner_api_key: apiKey }, select: { id: true } })) return result;
  const key = await db.api_keys.findUnique({ where: { key: apiKey }, select: { primary_feed_id: true } });
  if (!key?.primary_feed_id) return result;
  const feed = await db.prod_feeds.findFirst({ where: { id: key.primary_feed_id, owner_api_key: apiKey }, select: { id: true } });
  if (!feed) return result;

  const dsk = await compositeViewportName(db, apiKey);
  const programId = generateOutputId();
  await db.outputs.create({
    data: {
      id: programId, owner_api_key: apiKey, name: PROGRAM_OUTPUT_NAME, source_type: 'feed', source_id: feed.id,
      dsk_json: JSON.stringify(dsk ? [dsk] : []), sort_order: 0, created_at: db.$util.sqlNow(),
    },
  });
  result.program = programId;
  await db.rtmp_relays.updateMany({ where: { api_key: apiKey, source_view: 'program', source_feed_id: null, source_output_id: null }, data: { source_output_id: programId } });

  if (await projectHasCrop(db, apiKey)) {
    const cfg = await db.crop_config.findUnique({ where: { api_key: apiKey } });
    const verticalId = generateOutputId();
    await db.outputs.create({
      data: {
        id: verticalId, owner_api_key: apiKey, name: VERTICAL_OUTPUT_NAME, source_type: 'output', source_id: programId,
        crop_enabled: cfg?.enabled === 1 ? 1 : 0, sort_order: 1, created_at: db.$util.sqlNow(),
      },
    });
    if (cfg) {
      const { api_key: _ignored, ...fields } = cfg;
      await db.output_crop_config.create({ data: { output_id: verticalId, ...fields } });
    }
    for (const table of ['crop_preset_sets', 'crop_presets', 'crop_source_map']) {
      await db[table].updateMany({ where: { api_key: apiKey, output_id: null }, data: { output_id: verticalId } });
    }
    await db.rtmp_relays.updateMany({ where: { api_key: apiKey, source_view: 'crop', source_feed_id: null, source_output_id: null }, data: { source_output_id: verticalId } });
    result.vertical = verticalId;
  }
  return result;
}

/**
 * Create the default outputs of every project that has none (idempotent, never throws per project).
 * Run at startup after the primary-feed backfill. @returns {Promise<{ projects: number, outputs: number }>}
 */
export async function backfillOutputs(db) {
  const keys = await db.api_keys.findMany({ where: { primary_feed_id: { not: null } }, select: { key: true } });
  let projects = 0;
  let outputs = 0;
  for (const { key } of keys) {
    try {
      const r = await ensureProjectOutputs(db, key);
      const n = (r.program ? 1 : 0) + (r.vertical ? 1 : 0);
      if (n) { projects++; outputs += n; }
    } catch (err) {
      logger.warn(`[outputs] backfill skipped a project: ${err.message}`);
    }
  }
  return { projects, outputs };
}
