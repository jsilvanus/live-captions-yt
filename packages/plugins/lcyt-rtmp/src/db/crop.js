/**
 * Vertical-crop DB helpers (async, Prisma client) (plan_vertical_crop.md §1).
 *
 * Tables:
 *   crop_config       — one row per api_key: output geometry + behaviour flags
 *   crop_preset_sets  — named "banks" of crop positions
 *   crop_presets      — named positions (normalised 0..1 of the travel range)
 *   crop_source_map   — production-follow mapping (mixer input / camera+PTZ
 *                       preset → crop preset); most-specific row wins
 *
 * Positions are stored NORMALISED (0..1 of the max travel range) so presets
 * survive an input-resolution change; pixel conversion happens in
 * crop-manager.js at apply time.
 *
 * The tables come from the backend's Prisma schema / PostgreSQL migrations. Foreign keys are enforced
 * (ON DELETE CASCADE), the manual deletes below are redundant but kept.
 *
 * crop_source_map is read and written with raw SQL (the Prisma model API is used for the other tables).
 * camera_preset is TEXT: it always holds an opaque string preset key (see toPresetKeyOrNull).
 */
import { randomUUID } from 'node:crypto';

// ── helpers ─────────────────────────────────────────────────────────────────

const clamp01 = v => Math.max(0, Math.min(1, Number(v)));

/**
 * Coerce a mixer-input value to an integer or null.
 * JSON bodies and env-derived values often carry these as strings; the
 * source-map resolver compares with strict equality, so both the stored and
 * the queried values must be normalised to the same type.
 * Returns NaN for values that are set but not integer-coercible.
 */
function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Normalise a camera-preset identifier to a trimmed string or null.
 *
 * Camera presets in this codebase (`lcyt-production`'s
 * `prod_cameras.control_config.presets[].id`, the value
 * `POST /production/cameras/:id/preset/:presetId` and
 * `registry.callPreset()`/`onCameraPresetRecalled` actually pass around) are
 * arbitrary per-camera string ids ('wide', 'close', a UUID — see that
 * plugin's amx.js/visca-ip.js adapters), not a universal numeric PTZ preset
 * number. `crop_source_map.camera_preset` (TEXT) therefore stores that opaque
 * id verbatim, and `resolveCropPresetForSource()` compares both sides as
 * strings.
 */
function toPresetKeyOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim() || null;
}

/**
 * Resolve which camera (if any) is wired to a given mixer program-input
 * number — used by CropManager.applyForSource() (plan_vertical_crop.md §4)
 * to turn a bare onProgramChanged({ inputNumber }) into a cameraId for
 * crop_source_map resolution. Cross-plugin query, same guarded pattern as
 * resolveRelaySourceFeedKey()/getApiKeysReferencingFeed() below.
 * prod_cameras.mixer_input is not itself scoped to a specific mixer id
 * (lcyt-production has no camera→mixer FK — see routes/mixers.js's
 * GET /:id/sources, which reads it the same unscoped way), so this only
 * takes the input number.
 * @returns {Promise<string|null>}
 */
export async function resolveCameraIdForMixerInput(db, mixerInput) {
  if (mixerInput === null || mixerInput === undefined) return null;
  const input = Number(mixerInput);
  if (!Number.isInteger(input)) return null;
  const row = await db.prod_cameras.findFirst({ where: { mixer_input: input }, select: { id: true } });
  return row?.id ?? null;
}

function formatConfig(row) {
  return {
    enabled:       row.enabled === 1,
    aspectW:       row.aspect_w,
    aspectH:       row.aspect_h,
    outW:          row.out_w ?? null,
    outH:          row.out_h ?? null,
    videoBitrate:  row.video_bitrate ?? null,
    followProgram: row.follow_program === 1,
    transitionMs:  row.transition_ms,
    activeSetId:   row.active_set_id ?? null,
    autoFollow:    row.auto_follow === 1,
  };
}

const DEFAULT_CONFIG = Object.freeze({
  enabled: false, aspectW: 9, aspectH: 16, outW: null, outH: null,
  videoBitrate: null, followProgram: true, transitionMs: 0, activeSetId: null, autoFollow: false,
});

/**
 * @returns {Promise<object>} config (defaults when no row exists)
 */
export async function getCropConfig(db, apiKey) {
  const row = await db.crop_config.findUnique({ where: { api_key: apiKey } });
  return row ? formatConfig(row) : { ...DEFAULT_CONFIG };
}

/**
 * Upsert crop config. Only provided fields change.
 * @returns {Promise<{ ok: true, config: object } | { ok: false, error: string }>}
 */
export async function setCropConfig(db, apiKey, patch = {}) {
  const { enabled, aspectW, aspectH, outW, outH, videoBitrate, followProgram, transitionMs, activeSetId, autoFollow } = patch;

  const isPosInt = v => Number.isInteger(v) && v > 0;
  if (aspectW !== undefined && !isPosInt(aspectW)) return { ok: false, error: 'aspectW must be a positive integer' };
  if (aspectH !== undefined && !isPosInt(aspectH)) return { ok: false, error: 'aspectH must be a positive integer' };
  if (outW !== undefined && outW !== null && !isPosInt(outW)) return { ok: false, error: 'outW must be a positive integer or null' };
  if (outH !== undefined && outH !== null && !isPosInt(outH)) return { ok: false, error: 'outH must be a positive integer or null' };
  if (transitionMs !== undefined && (!Number.isInteger(transitionMs) || transitionMs < 0 || transitionMs > 10_000)) {
    return { ok: false, error: 'transitionMs must be an integer 0-10000' };
  }
  if (videoBitrate !== undefined && videoBitrate !== null && !/^\d+[kKmM]?$/.test(String(videoBitrate))) {
    return { ok: false, error: "videoBitrate must look like '4500k'" };
  }
  if (activeSetId !== undefined && activeSetId !== null) {
    const set = await db.crop_preset_sets.findFirst({ where: { api_key: apiKey, id: String(activeSetId) }, select: { id: true } });
    if (!set) return { ok: false, error: 'activeSetId does not reference one of this project\'s sets' };
  }

  const existing = await db.crop_config.findUnique({ where: { api_key: apiKey } });
  const cur = existing ? formatConfig(existing) : { ...DEFAULT_CONFIG };
  const next = {
    enabled:       enabled       !== undefined ? Boolean(enabled)       : cur.enabled,
    aspectW:       aspectW       !== undefined ? aspectW                : cur.aspectW,
    aspectH:       aspectH       !== undefined ? aspectH                : cur.aspectH,
    outW:          outW          !== undefined ? outW                   : cur.outW,
    outH:          outH          !== undefined ? outH                   : cur.outH,
    videoBitrate:  videoBitrate  !== undefined ? videoBitrate           : cur.videoBitrate,
    followProgram: followProgram !== undefined ? Boolean(followProgram) : cur.followProgram,
    transitionMs:  transitionMs  !== undefined ? transitionMs           : cur.transitionMs,
    activeSetId:   activeSetId   !== undefined ? activeSetId            : cur.activeSetId,
    autoFollow:    autoFollow    !== undefined ? Boolean(autoFollow)    : cur.autoFollow,
  };

  const values = {
    enabled: next.enabled ? 1 : 0,
    aspect_w: next.aspectW,
    aspect_h: next.aspectH,
    out_w: next.outW,
    out_h: next.outH,
    video_bitrate: next.videoBitrate,
    follow_program: next.followProgram ? 1 : 0,
    transition_ms: next.transitionMs,
    active_set_id: next.activeSetId,
    auto_follow: next.autoFollow ? 1 : 0,
    updated_at: db.$util.sqlNow(),
  };
  await db.crop_config.upsert({ where: { api_key: apiKey }, create: { api_key: apiKey, ...values }, update: values });
  return { ok: true, config: await getCropConfig(db, apiKey) };
}

// ── preset sets ─────────────────────────────────────────────────────────────

function formatSet(row) {
  return { id: row.id, name: row.name, sortOrder: row.sort_order, createdAt: row.created_at };
}

export async function listCropSets(db, apiKey) {
  const rows = await db.crop_preset_sets.findMany({
    where: { api_key: apiKey },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  return rows.map(formatSet);
}

const isUniqueViolation = err => err?.code === 'P2002' || /UNIQUE|unique constraint/i.test(err?.message ?? '');

/**
 * Create a preset set; optionally clone all presets (and their source-map
 * rows) from another set as a starting point.
 * @returns {Promise<{ ok: true, set: object } | { ok: false, error: string }>}
 */
export async function createCropSet(db, apiKey, { name, sortOrder = 0, cloneFromSetId = null } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) return { ok: false, error: 'name is required' };
  const id = randomUUID();
  const createdAt = db.$util.sqlNow();
  try {
    await db.$transaction(async tx => {
      await tx.crop_preset_sets.create({ data: { id, api_key: apiKey, name: name.trim(), sort_order: sortOrder, created_at: createdAt } });
      if (cloneFromSetId) {
        const source = await tx.crop_presets.findMany({
          where: { api_key: apiKey, set_id: cloneFromSetId },
          orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        });
        for (const p of source) {
          const newPresetId = randomUUID();
          await tx.crop_presets.create({
            data: { id: newPresetId, api_key: apiKey, set_id: id, name: p.name, x_norm: p.x_norm, y_norm: p.y_norm, sort_order: p.sort_order, created_at: createdAt },
          });
          const maps = await tx.$queryRaw`SELECT * FROM crop_source_map WHERE api_key = ${apiKey} AND preset_id = ${p.id}`;
          for (const m of maps) {
            await insertSourceMapRow(tx, {
              id: randomUUID(), apiKey, mixerId: m.mixer_id, mixerInput: db.$util.num(m.mixer_input),
              cameraId: m.camera_id, cameraPreset: m.camera_preset, presetId: newPresetId,
            });
          }
        }
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: `A set named "${name.trim()}" already exists` };
    return { ok: false, error: err.message };
  }
  const row = await db.crop_preset_sets.findUnique({ where: { id } });
  return { ok: true, set: formatSet(row) };
}

export async function updateCropSet(db, apiKey, id, { name, sortOrder } = {}) {
  const existing = await db.crop_preset_sets.findFirst({ where: { api_key: apiKey, id: String(id) } });
  if (!existing) return { ok: false, error: 'Set not found', status: 404 };
  try {
    await db.crop_preset_sets.update({
      where: { id: existing.id },
      data: {
        name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        sort_order: sortOrder ?? existing.sort_order,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: `A set named "${name}" already exists` };
    return { ok: false, error: err.message };
  }
  return { ok: true, set: formatSet(await db.crop_preset_sets.findUnique({ where: { id: existing.id } })) };
}

/** Deletes a set with its presets and their source-map rows (manual cascade). */
export async function deleteCropSet(db, apiKey, id) {
  const existing = await db.crop_preset_sets.findFirst({ where: { api_key: apiKey, id: String(id) }, select: { id: true } });
  if (!existing) return false;
  await db.$transaction(async tx => {
    const presets = await tx.crop_presets.findMany({ where: { api_key: apiKey, set_id: existing.id }, select: { id: true } });
    await tx.crop_source_map.deleteMany({ where: { api_key: apiKey, preset_id: { in: presets.map(p => p.id) } } });
    await tx.crop_presets.deleteMany({ where: { api_key: apiKey, set_id: existing.id } });
    await tx.crop_preset_sets.deleteMany({ where: { api_key: apiKey, id: existing.id } });
    await tx.crop_config.updateMany({ where: { api_key: apiKey, active_set_id: existing.id }, data: { active_set_id: null } });
  });
  return true;
}

// ── presets ─────────────────────────────────────────────────────────────────

function formatPreset(row) {
  return {
    id:        row.id,
    setId:     row.set_id ?? null,
    name:      row.name,
    xNorm:     row.x_norm,
    yNorm:     row.y_norm,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

/**
 * List presets. When `setId` is undefined the project's ACTIVE set is used
 * (null = the implicit default set, i.e. presets with set_id IS NULL).
 */
export async function listCropPresets(db, apiKey, { setId } = {}) {
  const effectiveSetId = setId !== undefined ? setId : (await getCropConfig(db, apiKey)).activeSetId;
  const rows = await db.crop_presets.findMany({
    where: { api_key: apiKey, set_id: effectiveSetId === null ? null : String(effectiveSetId) },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  return rows.map(formatPreset);
}

export async function getCropPreset(db, apiKey, id) {
  const row = await db.crop_presets.findFirst({ where: { api_key: apiKey, id: String(id) } });
  return row ? formatPreset(row) : null;
}

export async function createCropPreset(db, apiKey, { name, xNorm = 0.5, yNorm = 0, setId = null, sortOrder = 0 } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) return { ok: false, error: 'name is required' };
  if (!Number.isFinite(Number(xNorm)) || !Number.isFinite(Number(yNorm))) {
    return { ok: false, error: 'xNorm and yNorm must be numbers' };
  }
  if (setId !== null) {
    const set = await db.crop_preset_sets.findFirst({ where: { api_key: apiKey, id: String(setId) }, select: { id: true } });
    if (!set) return { ok: false, error: 'setId does not reference one of this project\'s sets' };
  }
  const id = randomUUID();
  try {
    await db.crop_presets.create({
      data: {
        id, api_key: apiKey, set_id: setId, name: name.trim(), x_norm: clamp01(xNorm), y_norm: clamp01(yNorm),
        sort_order: sortOrder, created_at: db.$util.sqlNow(),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: `A preset named "${name.trim()}" already exists in this set` };
    return { ok: false, error: err.message };
  }
  return { ok: true, preset: await getCropPreset(db, apiKey, id) };
}

export async function updateCropPreset(db, apiKey, id, { name, xNorm, yNorm, sortOrder } = {}) {
  const existing = await db.crop_presets.findFirst({ where: { api_key: apiKey, id: String(id) } });
  if (!existing) return { ok: false, error: 'Preset not found', status: 404 };
  if ((xNorm !== undefined && !Number.isFinite(Number(xNorm))) || (yNorm !== undefined && !Number.isFinite(Number(yNorm)))) {
    return { ok: false, error: 'xNorm and yNorm must be numbers' };
  }
  try {
    await db.crop_presets.update({
      where: { id: existing.id },
      data: {
        name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        x_norm: xNorm !== undefined ? clamp01(xNorm) : existing.x_norm,
        y_norm: yNorm !== undefined ? clamp01(yNorm) : existing.y_norm,
        sort_order: sortOrder ?? existing.sort_order,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: `A preset named "${name}" already exists in this set` };
    return { ok: false, error: err.message };
  }
  return { ok: true, preset: await getCropPreset(db, apiKey, existing.id) };
}

/** Deletes a preset and its source-map rows (manual cascade). */
export async function deleteCropPreset(db, apiKey, id) {
  const existing = await db.crop_presets.findFirst({ where: { api_key: apiKey, id: String(id) }, select: { id: true } });
  if (!existing) return false;
  await db.$transaction(async tx => {
    await tx.crop_source_map.deleteMany({ where: { api_key: apiKey, preset_id: existing.id } });
    await tx.crop_presets.deleteMany({ where: { api_key: apiKey, id: existing.id } });
  });
  return true;
}

// ── source map ──────────────────────────────────────────────────────────────

function formatMapRow(row) {
  return {
    id:           row.id,
    mixerId:      row.mixer_id ?? null,
    mixerInput:   row.mixer_input ?? null,
    cameraId:     row.camera_id ?? null,
    cameraPreset: row.camera_preset ?? null,
    presetId:     row.preset_id,
  };
}

/** Raw rows of crop_source_map with BigInt integers turned into numbers. */
async function sourceMapRows(db, apiKey, id = null) {
  const rows = id === null
    ? await db.$queryRaw`SELECT * FROM crop_source_map WHERE api_key = ${apiKey}`
    : await db.$queryRaw`SELECT * FROM crop_source_map WHERE api_key = ${apiKey} AND id = ${id}`;
  return rows.map(r => ({ ...r, mixer_input: db.$util.num(r.mixer_input) }));
}

/** Insert one crop_source_map row. camera_preset is TEXT; the caller passes it already normalised. */
async function insertSourceMapRow(db, { id, apiKey, mixerId, mixerInput, cameraId, cameraPreset, presetId }) {
  await db.$executeRaw`INSERT INTO crop_source_map (id, api_key, mixer_id, mixer_input, camera_id, camera_preset, preset_id)
    VALUES (${id}, ${apiKey}, ${mixerId ?? null}, ${mixerInput ?? null}, ${cameraId ?? null}, ${cameraPreset ?? null}, ${presetId})`;
}

export async function listCropSourceMap(db, apiKey) {
  return (await sourceMapRows(db, apiKey)).map(formatMapRow);
}

export async function createCropSourceMapEntry(db, apiKey, { mixerId = null, mixerInput = null, cameraId = null, cameraPreset = null, presetId } = {}) {
  if (!presetId) return { ok: false, error: 'presetId is required' };
  const preset = await db.crop_presets.findFirst({ where: { api_key: apiKey, id: String(presetId) }, select: { id: true } });
  if (!preset) return { ok: false, error: 'presetId does not reference one of this project\'s presets' };

  const normMixerInput   = toIntOrNull(mixerInput);
  const normCameraPreset = toPresetKeyOrNull(cameraPreset);
  if (Number.isNaN(normMixerInput))   return { ok: false, error: 'mixerInput must be an integer' };
  const normMixerId  = mixerId  != null && mixerId  !== '' ? String(mixerId)  : null;
  const normCameraId = cameraId != null && cameraId !== '' ? String(cameraId) : null;

  const hasMixer = normMixerId !== null || normMixerInput !== null;
  const hasCamera = normCameraId !== null;
  if (!hasMixer && !hasCamera) {
    return { ok: false, error: 'At least one of mixerId/mixerInput or cameraId must be set' };
  }
  const id = randomUUID();
  try {
    await insertSourceMapRow(db, {
      id, apiKey, mixerId: normMixerId, mixerInput: normMixerInput, cameraId: normCameraId, cameraPreset: normCameraPreset, presetId: preset.id,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const [row] = await sourceMapRows(db, apiKey, id);
  return { ok: true, entry: formatMapRow(row) };
}

export async function deleteCropSourceMapEntry(db, apiKey, id) {
  return (await db.crop_source_map.deleteMany({ where: { api_key: apiKey, id: String(id) } })).count > 0;
}

/**
 * Resolve which preset should be active for a program-source change.
 * Most-specific row wins: (camera_id + camera_preset) beats (camera_id) beats
 * (mixer_id + mixer_input) beats (mixer_input only). Resolution is scoped to
 * the project's ACTIVE preset set — a map row pointing at a preset from a
 * different set is ignored.
 *
 * @param {object} src { mixerId?, mixerInput?, cameraId?, cameraPreset? }
 * @returns {Promise<object|null>} the winning preset (formatPreset shape) or null
 */
export async function resolveCropPresetForSource(db, apiKey, { mixerId = null, mixerInput = null, cameraId = null, cameraPreset = null } = {}) {
  // Normalise caller-provided values (JSON bodies often carry numbers as
  // strings) so the strict comparisons below match the normalised DB values.
  mixerInput   = toIntOrNull(mixerInput);
  cameraPreset = toPresetKeyOrNull(cameraPreset);
  if (Number.isNaN(mixerInput))   mixerInput = null;
  mixerId  = mixerId  != null && mixerId  !== '' ? String(mixerId)  : null;
  cameraId = cameraId != null && cameraId !== '' ? String(cameraId) : null;

  const activeSetId = (await getCropConfig(db, apiKey)).activeSetId;
  const rows = await sourceMapRows(db, apiKey);

  let best = null;
  let bestScore = -1;
  for (const row of rows) {
    let score = 0;
    if (row.camera_id !== null) {
      if (row.camera_id !== cameraId) continue;
      score += 4;
      if (row.camera_preset !== null) {
        // String comparison — camera_preset is an opaque per-camera preset
        // id (see toPresetKeyOrNull above); String() also covers a query
        // that arrives as a number.
        if (cameraPreset === null || String(row.camera_preset) !== String(cameraPreset)) continue;
        score += 4;
      }
    }
    if (row.mixer_input !== null) {
      if (row.mixer_input !== mixerInput) continue;
      score += 2;
      if (row.mixer_id !== null) {
        if (row.mixer_id !== mixerId) continue;
        score += 1;
      }
    } else if (row.mixer_id !== null) {
      if (row.mixer_id !== mixerId) continue;
      score += 1;
    }
    if (score === 0) continue;

    const preset = await db.crop_presets.findFirst({ where: { api_key: apiKey, id: row.preset_id } });
    if (!preset) continue;
    if ((preset.set_id ?? null) !== activeSetId) continue;

    if (score > bestScore) {
      bestScore = score;
      best = preset;
    }
  }
  return best ? formatPreset(best) : null;
}
