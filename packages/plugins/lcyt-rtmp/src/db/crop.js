/**
 * Vertical-crop DB migrations and helpers (plan_vertical_crop.md §1).
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
 * NOTE: `PRAGMA foreign_keys` is not enabled repo-wide (see CONSIDER.md), so
 * ON DELETE CASCADE declarations are inert — deletes cascade manually here.
 */
import { randomUUID } from 'node:crypto';
import { hasProdCamerasTable } from './relay.js';

export function runCropMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crop_config (
      api_key         TEXT PRIMARY KEY,
      enabled         INTEGER NOT NULL DEFAULT 0,
      aspect_w        INTEGER NOT NULL DEFAULT 9,
      aspect_h        INTEGER NOT NULL DEFAULT 16,
      out_w           INTEGER,
      out_h           INTEGER,
      video_bitrate   TEXT,
      follow_program  INTEGER NOT NULL DEFAULT 1,
      transition_ms   INTEGER NOT NULL DEFAULT 0,
      active_set_id   TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crop_preset_sets (
      id          TEXT PRIMARY KEY,
      api_key     TEXT NOT NULL,
      name        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, name)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crop_presets (
      id          TEXT PRIMARY KEY,
      api_key     TEXT NOT NULL,
      set_id      TEXT REFERENCES crop_preset_sets(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      x_norm      REAL NOT NULL DEFAULT 0.5,
      y_norm      REAL NOT NULL DEFAULT 0.0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, set_id, name)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crop_presets_key ON crop_presets(api_key, set_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS crop_source_map (
      id             TEXT PRIMARY KEY,
      api_key        TEXT NOT NULL,
      mixer_id       TEXT,
      mixer_input    INTEGER,
      camera_id      TEXT,
      camera_preset  INTEGER,
      preset_id      TEXT NOT NULL REFERENCES crop_presets(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crop_source_map_key ON crop_source_map(api_key)');
}

// ── helpers ─────────────────────────────────────────────────────────────────

const clamp01 = v => Math.max(0, Math.min(1, Number(v)));

/**
 * Coerce a mixer-input / camera-preset value to an integer or null.
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
 * number. `crop_source_map.camera_preset` therefore stores that opaque id
 * verbatim rather than coercing it to an integer — the column keeps its
 * INTEGER declaration for legacy compatibility (SQLite's type affinity does
 * not reject a non-numeric TEXT value in an INTEGER-affinity column, it just
 * stores it as-is), and `resolveCropPresetForSource()` compares both sides
 * as strings so a pre-existing numeric-camera_preset row still matches.
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
 * resolveRelaySourceCameraKey()/getApiKeysReferencingCamera() below.
 * prod_cameras.mixer_input is not itself scoped to a specific mixer id
 * (lcyt-production has no camera→mixer FK — see routes/mixers.js's
 * GET /:id/sources, which reads it the same unscoped way), so this only
 * takes the input number.
 * @returns {string|null}
 */
export function resolveCameraIdForMixerInput(db, mixerInput) {
  if (mixerInput === null || mixerInput === undefined) return null;
  if (!hasProdCamerasTable(db)) return null;
  const row = db.prepare('SELECT id FROM prod_cameras WHERE mixer_input = ?').get(mixerInput);
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
  };
}

const DEFAULT_CONFIG = Object.freeze({
  enabled: false, aspectW: 9, aspectH: 16, outW: null, outH: null,
  videoBitrate: null, followProgram: true, transitionMs: 0, activeSetId: null,
});

/**
 * @returns {object} config (defaults when no row exists)
 */
export function getCropConfig(db, apiKey) {
  const row = db.prepare('SELECT * FROM crop_config WHERE api_key = ?').get(apiKey);
  return row ? formatConfig(row) : { ...DEFAULT_CONFIG };
}

/**
 * Upsert crop config. Only provided fields change.
 * @returns {{ ok: true, config: object } | { ok: false, error: string }}
 */
export function setCropConfig(db, apiKey, patch = {}) {
  const { enabled, aspectW, aspectH, outW, outH, videoBitrate, followProgram, transitionMs, activeSetId } = patch;

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
    const set = db.prepare('SELECT id FROM crop_preset_sets WHERE api_key = ? AND id = ?').get(apiKey, activeSetId);
    if (!set) return { ok: false, error: 'activeSetId does not reference one of this project\'s sets' };
  }

  const existing = db.prepare('SELECT * FROM crop_config WHERE api_key = ?').get(apiKey);
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
  };

  db.prepare(`
    INSERT INTO crop_config (api_key, enabled, aspect_w, aspect_h, out_w, out_h, video_bitrate, follow_program, transition_ms, active_set_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(api_key) DO UPDATE SET
      enabled = excluded.enabled, aspect_w = excluded.aspect_w, aspect_h = excluded.aspect_h,
      out_w = excluded.out_w, out_h = excluded.out_h, video_bitrate = excluded.video_bitrate,
      follow_program = excluded.follow_program, transition_ms = excluded.transition_ms,
      active_set_id = excluded.active_set_id, updated_at = datetime('now')
  `).run(
    apiKey, next.enabled ? 1 : 0, next.aspectW, next.aspectH, next.outW, next.outH,
    next.videoBitrate, next.followProgram ? 1 : 0, next.transitionMs, next.activeSetId,
  );
  return { ok: true, config: getCropConfig(db, apiKey) };
}

// ── preset sets ─────────────────────────────────────────────────────────────

function formatSet(row) {
  return { id: row.id, name: row.name, sortOrder: row.sort_order, createdAt: row.created_at };
}

export function listCropSets(db, apiKey) {
  return db.prepare('SELECT * FROM crop_preset_sets WHERE api_key = ? ORDER BY sort_order, created_at')
    .all(apiKey).map(formatSet);
}

/**
 * Create a preset set; optionally clone all presets (and their source-map
 * rows) from another set as a starting point.
 * @returns {{ ok: true, set: object } | { ok: false, error: string }}
 */
export function createCropSet(db, apiKey, { name, sortOrder = 0, cloneFromSetId = null } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) return { ok: false, error: 'name is required' };
  const id = randomUUID();
  try {
    db.transaction(() => {
      db.prepare('INSERT INTO crop_preset_sets (id, api_key, name, sort_order) VALUES (?, ?, ?, ?)')
        .run(id, apiKey, name.trim(), sortOrder);
      if (cloneFromSetId) {
        const source = db.prepare('SELECT * FROM crop_presets WHERE api_key = ? AND set_id = ? ORDER BY sort_order, created_at')
          .all(apiKey, cloneFromSetId);
        for (const p of source) {
          const newPresetId = randomUUID();
          db.prepare('INSERT INTO crop_presets (id, api_key, set_id, name, x_norm, y_norm, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(newPresetId, apiKey, id, p.name, p.x_norm, p.y_norm, p.sort_order);
          const maps = db.prepare('SELECT * FROM crop_source_map WHERE api_key = ? AND preset_id = ?').all(apiKey, p.id);
          for (const m of maps) {
            db.prepare('INSERT INTO crop_source_map (id, api_key, mixer_id, mixer_input, camera_id, camera_preset, preset_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(randomUUID(), apiKey, m.mixer_id, m.mixer_input, m.camera_id, m.camera_preset, newPresetId);
          }
        }
      }
    })();
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return { ok: false, error: `A set named "${name.trim()}" already exists` };
    return { ok: false, error: err.message };
  }
  const row = db.prepare('SELECT * FROM crop_preset_sets WHERE id = ?').get(id);
  return { ok: true, set: formatSet(row) };
}

export function updateCropSet(db, apiKey, id, { name, sortOrder } = {}) {
  const existing = db.prepare('SELECT * FROM crop_preset_sets WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) return { ok: false, error: 'Set not found', status: 404 };
  try {
    db.prepare('UPDATE crop_preset_sets SET name = ?, sort_order = ? WHERE api_key = ? AND id = ?')
      .run(
        typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        sortOrder ?? existing.sort_order,
        apiKey, id,
      );
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return { ok: false, error: `A set named "${name}" already exists` };
    return { ok: false, error: err.message };
  }
  return { ok: true, set: formatSet(db.prepare('SELECT * FROM crop_preset_sets WHERE id = ?').get(id)) };
}

/** Deletes a set with its presets and their source-map rows (manual cascade). */
export function deleteCropSet(db, apiKey, id) {
  const existing = db.prepare('SELECT id FROM crop_preset_sets WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM crop_source_map WHERE api_key = ? AND preset_id IN (SELECT id FROM crop_presets WHERE api_key = ? AND set_id = ?)')
      .run(apiKey, apiKey, id);
    db.prepare('DELETE FROM crop_presets WHERE api_key = ? AND set_id = ?').run(apiKey, id);
    db.prepare('DELETE FROM crop_preset_sets WHERE api_key = ? AND id = ?').run(apiKey, id);
    db.prepare('UPDATE crop_config SET active_set_id = NULL WHERE api_key = ? AND active_set_id = ?').run(apiKey, id);
  })();
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
export function listCropPresets(db, apiKey, { setId } = {}) {
  const effectiveSetId = setId !== undefined ? setId : getCropConfig(db, apiKey).activeSetId;
  const rows = effectiveSetId === null
    ? db.prepare('SELECT * FROM crop_presets WHERE api_key = ? AND set_id IS NULL ORDER BY sort_order, created_at').all(apiKey)
    : db.prepare('SELECT * FROM crop_presets WHERE api_key = ? AND set_id = ? ORDER BY sort_order, created_at').all(apiKey, effectiveSetId);
  return rows.map(formatPreset);
}

export function getCropPreset(db, apiKey, id) {
  const row = db.prepare('SELECT * FROM crop_presets WHERE api_key = ? AND id = ?').get(apiKey, id);
  return row ? formatPreset(row) : null;
}

export function createCropPreset(db, apiKey, { name, xNorm = 0.5, yNorm = 0, setId = null, sortOrder = 0 } = {}) {
  if (!name || typeof name !== 'string' || !name.trim()) return { ok: false, error: 'name is required' };
  if (!Number.isFinite(Number(xNorm)) || !Number.isFinite(Number(yNorm))) {
    return { ok: false, error: 'xNorm and yNorm must be numbers' };
  }
  if (setId !== null) {
    const set = db.prepare('SELECT id FROM crop_preset_sets WHERE api_key = ? AND id = ?').get(apiKey, setId);
    if (!set) return { ok: false, error: 'setId does not reference one of this project\'s sets' };
  }
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO crop_presets (id, api_key, set_id, name, x_norm, y_norm, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, apiKey, setId, name.trim(), clamp01(xNorm), clamp01(yNorm), sortOrder);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return { ok: false, error: `A preset named "${name.trim()}" already exists in this set` };
    return { ok: false, error: err.message };
  }
  return { ok: true, preset: getCropPreset(db, apiKey, id) };
}

export function updateCropPreset(db, apiKey, id, { name, xNorm, yNorm, sortOrder } = {}) {
  const existing = db.prepare('SELECT * FROM crop_presets WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) return { ok: false, error: 'Preset not found', status: 404 };
  if ((xNorm !== undefined && !Number.isFinite(Number(xNorm))) || (yNorm !== undefined && !Number.isFinite(Number(yNorm)))) {
    return { ok: false, error: 'xNorm and yNorm must be numbers' };
  }
  try {
    db.prepare('UPDATE crop_presets SET name = ?, x_norm = ?, y_norm = ?, sort_order = ? WHERE api_key = ? AND id = ?')
      .run(
        typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        xNorm !== undefined ? clamp01(xNorm) : existing.x_norm,
        yNorm !== undefined ? clamp01(yNorm) : existing.y_norm,
        sortOrder ?? existing.sort_order,
        apiKey, id,
      );
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return { ok: false, error: `A preset named "${name}" already exists in this set` };
    return { ok: false, error: err.message };
  }
  return { ok: true, preset: getCropPreset(db, apiKey, id) };
}

/** Deletes a preset and its source-map rows (manual cascade). */
export function deleteCropPreset(db, apiKey, id) {
  const existing = db.prepare('SELECT id FROM crop_presets WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM crop_source_map WHERE api_key = ? AND preset_id = ?').run(apiKey, id);
    db.prepare('DELETE FROM crop_presets WHERE api_key = ? AND id = ?').run(apiKey, id);
  })();
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

export function listCropSourceMap(db, apiKey) {
  return db.prepare('SELECT * FROM crop_source_map WHERE api_key = ?').all(apiKey).map(formatMapRow);
}

export function createCropSourceMapEntry(db, apiKey, { mixerId = null, mixerInput = null, cameraId = null, cameraPreset = null, presetId } = {}) {
  if (!presetId) return { ok: false, error: 'presetId is required' };
  const preset = db.prepare('SELECT id FROM crop_presets WHERE api_key = ? AND id = ?').get(apiKey, presetId);
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
  db.prepare('INSERT INTO crop_source_map (id, api_key, mixer_id, mixer_input, camera_id, camera_preset, preset_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, apiKey, normMixerId, normMixerInput, normCameraId, normCameraPreset, presetId);
  return { ok: true, entry: formatMapRow(db.prepare('SELECT * FROM crop_source_map WHERE id = ?').get(id)) };
}

export function deleteCropSourceMapEntry(db, apiKey, id) {
  return db.prepare('DELETE FROM crop_source_map WHERE api_key = ? AND id = ?').run(apiKey, id).changes > 0;
}

/**
 * Resolve which preset should be active for a program-source change.
 * Most-specific row wins: (camera_id + camera_preset) beats (camera_id) beats
 * (mixer_id + mixer_input) beats (mixer_input only). Resolution is scoped to
 * the project's ACTIVE preset set — a map row pointing at a preset from a
 * different set is ignored.
 *
 * @param {object} src { mixerId?, mixerInput?, cameraId?, cameraPreset? }
 * @returns {object|null} the winning preset (formatPreset shape) or null
 */
export function resolveCropPresetForSource(db, apiKey, { mixerId = null, mixerInput = null, cameraId = null, cameraPreset = null } = {}) {
  // Normalise caller-provided values (JSON bodies often carry numbers as
  // strings) so the strict comparisons below match the normalised DB values.
  mixerInput   = toIntOrNull(mixerInput);
  cameraPreset = toPresetKeyOrNull(cameraPreset);
  if (Number.isNaN(mixerInput))   mixerInput = null;
  mixerId  = mixerId  != null && mixerId  !== '' ? String(mixerId)  : null;
  cameraId = cameraId != null && cameraId !== '' ? String(cameraId) : null;

  const activeSetId = getCropConfig(db, apiKey).activeSetId;
  const rows = db.prepare('SELECT * FROM crop_source_map WHERE api_key = ?').all(apiKey);

  let best = null;
  let bestScore = -1;
  for (const row of rows) {
    let score = 0;
    if (row.camera_id !== null) {
      if (row.camera_id !== cameraId) continue;
      score += 4;
      if (row.camera_preset !== null) {
        // String comparison — camera_preset is an opaque per-camera preset
        // id (see toPresetKeyOrNull above), not always stored as TEXT (a
        // pre-existing row may hold a plain SQLite INTEGER).
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

    const preset = db.prepare('SELECT * FROM crop_presets WHERE api_key = ? AND id = ?').get(apiKey, row.preset_id);
    if (!preset) continue;
    if ((preset.set_id ?? null) !== activeSetId) continue;

    if (score > bestScore) {
      bestScore = score;
      best = preset;
    }
  }
  return best ? formatPreset(best) : null;
}
