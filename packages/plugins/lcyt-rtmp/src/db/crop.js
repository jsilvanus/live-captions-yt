<<<<<<< HEAD
function toBool(value) {
  return value === 1 || value === true;
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toFloat(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createCropEntityId(apiKey) {
  return `${apiKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}
=======
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
>>>>>>> origin/main

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
<<<<<<< HEAD
      active_preset_id TEXT,
      x_norm          REAL NOT NULL DEFAULT 0.5,
      y_norm          REAL NOT NULL DEFAULT 0.0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
=======
>>>>>>> origin/main
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
<<<<<<< HEAD
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
=======
>>>>>>> origin/main
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
<<<<<<< HEAD
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, name)
    )
  `);

  const cfgCols = new Set(db.prepare('PRAGMA table_info(crop_config)').all().map(c => c.name));
  if (!cfgCols.has('active_set_id')) db.exec('ALTER TABLE crop_config ADD COLUMN active_set_id TEXT');
  if (!cfgCols.has('active_preset_id')) db.exec('ALTER TABLE crop_config ADD COLUMN active_preset_id TEXT');
  if (!cfgCols.has('x_norm')) db.exec('ALTER TABLE crop_config ADD COLUMN x_norm REAL NOT NULL DEFAULT 0.5');
  if (!cfgCols.has('y_norm')) db.exec('ALTER TABLE crop_config ADD COLUMN y_norm REAL NOT NULL DEFAULT 0.0');
  if (!cfgCols.has('updated_at')) db.exec("ALTER TABLE crop_config ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  if (!cfgCols.has('created_at')) db.exec("ALTER TABLE crop_config ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  if (!cfgCols.has('transition_ms')) db.exec('ALTER TABLE crop_config ADD COLUMN transition_ms INTEGER NOT NULL DEFAULT 0');
  if (!cfgCols.has('follow_program')) db.exec('ALTER TABLE crop_config ADD COLUMN follow_program INTEGER NOT NULL DEFAULT 1');
  if (!cfgCols.has('video_bitrate')) db.exec('ALTER TABLE crop_config ADD COLUMN video_bitrate TEXT');
  if (!cfgCols.has('out_h')) db.exec('ALTER TABLE crop_config ADD COLUMN out_h INTEGER');
  if (!cfgCols.has('out_w')) db.exec('ALTER TABLE crop_config ADD COLUMN out_w INTEGER');
  if (!cfgCols.has('aspect_h')) db.exec('ALTER TABLE crop_config ADD COLUMN aspect_h INTEGER NOT NULL DEFAULT 16');
  if (!cfgCols.has('aspect_w')) db.exec('ALTER TABLE crop_config ADD COLUMN aspect_w INTEGER NOT NULL DEFAULT 9');

  const setsCols = new Set(db.prepare('PRAGMA table_info(crop_preset_sets)').all().map(c => c.name));
  if (!setsCols.has('updated_at')) db.exec("ALTER TABLE crop_preset_sets ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");

  const presetCols = new Set(db.prepare('PRAGMA table_info(crop_presets)').all().map(c => c.name));
  if (!presetCols.has('set_id')) db.exec('ALTER TABLE crop_presets ADD COLUMN set_id TEXT');
  if (!presetCols.has('updated_at')) db.exec("ALTER TABLE crop_presets ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
}

export function getCropConfig(db, apiKey) {
  const row = db.prepare('SELECT * FROM crop_config WHERE api_key = ?').get(apiKey);
  if (!row) {
    return {
      apiKey,
      enabled: false,
      aspectW: 9,
      aspectH: 16,
      outW: null,
      outH: null,
      videoBitrate: null,
      followProgram: true,
      transitionMs: 0,
      activeSetId: null,
      activePresetId: null,
      xNorm: 0.5,
      yNorm: 0.0,
    };
  }
  return {
    apiKey,
    enabled: toBool(row.enabled),
    aspectW: toInt(row.aspect_w, 9),
    aspectH: toInt(row.aspect_h, 16),
    outW: row.out_w ?? null,
    outH: row.out_h ?? null,
    videoBitrate: row.video_bitrate ?? null,
    followProgram: toBool(row.follow_program),
    transitionMs: toInt(row.transition_ms, 0),
    activeSetId: row.active_set_id ?? null,
    activePresetId: row.active_preset_id ?? null,
    xNorm: toFloat(row.x_norm, 0.5),
    yNorm: toFloat(row.y_norm, 0.0),
  };
}

export function setCropConfig(db, apiKey, patch = {}) {
  const existing = getCropConfig(db, apiKey);
  const next = {
    ...existing,
    ...patch,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled,
    aspectW: patch.aspectW !== undefined ? toInt(patch.aspectW, existing.aspectW) : existing.aspectW,
    aspectH: patch.aspectH !== undefined ? toInt(patch.aspectH, existing.aspectH) : existing.aspectH,
    outW: patch.outW !== undefined ? (patch.outW === null ? null : toInt(patch.outW, existing.outW)) : existing.outW,
    outH: patch.outH !== undefined ? (patch.outH === null ? null : toInt(patch.outH, existing.outH)) : existing.outH,
    videoBitrate: patch.videoBitrate !== undefined ? (patch.videoBitrate === null ? null : String(patch.videoBitrate)) : existing.videoBitrate,
    followProgram: patch.followProgram !== undefined ? Boolean(patch.followProgram) : existing.followProgram,
    transitionMs: patch.transitionMs !== undefined ? toInt(patch.transitionMs, existing.transitionMs) : existing.transitionMs,
    activeSetId: patch.activeSetId !== undefined ? patch.activeSetId : existing.activeSetId,
    activePresetId: patch.activePresetId !== undefined ? patch.activePresetId : existing.activePresetId,
    xNorm: patch.xNorm !== undefined ? toFloat(patch.xNorm, existing.xNorm) : existing.xNorm,
    yNorm: patch.yNorm !== undefined ? toFloat(patch.yNorm, existing.yNorm) : existing.yNorm,
  };

  db.prepare(`
    INSERT INTO crop_config (
      api_key, enabled, aspect_w, aspect_h, out_w, out_h, video_bitrate,
      follow_program, transition_ms, active_set_id, active_preset_id, x_norm, y_norm, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(api_key) DO UPDATE SET
      enabled = excluded.enabled,
      aspect_w = excluded.aspect_w,
      aspect_h = excluded.aspect_h,
      out_w = excluded.out_w,
      out_h = excluded.out_h,
      video_bitrate = excluded.video_bitrate,
      follow_program = excluded.follow_program,
      transition_ms = excluded.transition_ms,
      active_set_id = excluded.active_set_id,
      active_preset_id = excluded.active_preset_id,
      x_norm = excluded.x_norm,
      y_norm = excluded.y_norm,
      updated_at = datetime('now')
  `).run(
    apiKey,
    next.enabled ? 1 : 0,
    next.aspectW,
    next.aspectH,
    next.outW,
    next.outH,
    next.videoBitrate,
    next.followProgram ? 1 : 0,
    next.transitionMs,
    next.activeSetId,
    next.activePresetId,
    next.xNorm,
    next.yNorm,
  );
  return getCropConfig(db, apiKey);
}

export function setCropPosition(db, apiKey, { xNorm, yNorm } = {}) {
  return setCropConfig(db, apiKey, {
    xNorm: xNorm ?? getCropConfig(db, apiKey).xNorm,
    yNorm: yNorm ?? getCropConfig(db, apiKey).yNorm,
  });
}

export function listCropPresetSets(db, apiKey) {
  return db.prepare('SELECT * FROM crop_preset_sets WHERE api_key = ? ORDER BY sort_order, id')
    .all(apiKey)
    .map(row => ({ id: row.id, apiKey: row.api_key, name: row.name, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function createCropPresetSet(db, apiKey, { name, sortOrder = 0 } = {}) {
  const id = createCropEntityId(apiKey);
  db.prepare('INSERT INTO crop_preset_sets (id, api_key, name, sort_order) VALUES (?, ?, ?, ?)')
    .run(id, apiKey, name, sortOrder);
  return getCropPresetSetById(db, id);
}

export function getCropPresetSetById(db, id) {
  const row = db.prepare('SELECT * FROM crop_preset_sets WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, apiKey: row.api_key, name: row.name, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function updateCropPresetSet(db, id, patch = {}) {
  const existing = getCropPresetSetById(db, id);
  if (!existing) return null;
  const name = patch.name ?? existing.name;
  const sortOrder = patch.sortOrder ?? existing.sortOrder;
  db.prepare('UPDATE crop_preset_sets SET name = ?, sort_order = ?, updated_at = datetime("now") WHERE id = ?').run(name, sortOrder, id);
  return getCropPresetSetById(db, id);
}

export function deleteCropPresetSet(db, id) {
  const row = getCropPresetSetById(db, id);
  if (!row) return false;
  db.prepare('DELETE FROM crop_preset_sets WHERE id = ?').run(id);
  const cfg = getCropConfig(db, row.apiKey);
  if (cfg.activeSetId === id) {
    setCropConfig(db, row.apiKey, { activeSetId: null });
  }
  return true;
}

export function listCropPresets(db, apiKey, { setId = null } = {}) {
  const rows = setId == null
    ? db.prepare('SELECT * FROM crop_presets WHERE api_key = ? ORDER BY sort_order, id').all(apiKey)
    : db.prepare('SELECT * FROM crop_presets WHERE api_key = ? AND set_id = ? ORDER BY sort_order, id').all(apiKey, setId);
  return rows.map(row => ({ id: row.id, apiKey: row.api_key, setId: row.set_id ?? null, name: row.name, xNorm: toFloat(row.x_norm, 0.5), yNorm: toFloat(row.y_norm, 0.0), sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function createCropPreset(db, apiKey, { name, xNorm = 0.5, yNorm = 0.0, setId = null, sortOrder = 0 } = {}) {
  const cfg = getCropConfig(db, apiKey);
  const resolvedSetId = setId ?? cfg.activeSetId ?? null;
  const id = createCropEntityId(apiKey);
  db.prepare('INSERT INTO crop_presets (id, api_key, set_id, name, x_norm, y_norm, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, apiKey, resolvedSetId, name, toFloat(xNorm, 0.5), toFloat(yNorm, 0.0), sortOrder);
  return getCropPresetById(db, id);
}

export function getCropPresetById(db, id) {
  const row = db.prepare('SELECT * FROM crop_presets WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, apiKey: row.api_key, setId: row.set_id ?? null, name: row.name, xNorm: toFloat(row.x_norm, 0.5), yNorm: toFloat(row.y_norm, 0.0), sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function updateCropPreset(db, id, patch = {}) {
  const existing = getCropPresetById(db, id);
  if (!existing) return null;
  const name = patch.name ?? existing.name;
  const setId = patch.setId !== undefined ? patch.setId : existing.setId;
  const xNorm = patch.xNorm !== undefined ? toFloat(patch.xNorm, existing.xNorm) : existing.xNorm;
  const yNorm = patch.yNorm !== undefined ? toFloat(patch.yNorm, existing.yNorm) : existing.yNorm;
  const sortOrder = patch.sortOrder !== undefined ? toInt(patch.sortOrder, existing.sortOrder) : existing.sortOrder;
  db.prepare('UPDATE crop_presets SET name = ?, set_id = ?, x_norm = ?, y_norm = ?, sort_order = ?, updated_at = datetime("now") WHERE id = ?').run(name, setId, xNorm, yNorm, sortOrder, id);
  return getCropPresetById(db, id);
}

export function deleteCropPreset(db, id) {
  const row = getCropPresetById(db, id);
  if (!row) return false;
  db.prepare('DELETE FROM crop_presets WHERE id = ?').run(id);
  const cfg = getCropConfig(db, row.apiKey);
  if (cfg.activePresetId === id) {
    setCropConfig(db, row.apiKey, { activePresetId: null });
  }
  return true;
}

export function activateCropPreset(db, apiKey, id) {
  const preset = getCropPresetById(db, id);
  if (!preset || preset.apiKey !== apiKey) return null;
  setCropConfig(db, apiKey, { activePresetId: id, xNorm: preset.xNorm, yNorm: preset.yNorm });
  return getCropConfig(db, apiKey);
}

export function activateCropPresetSet(db, apiKey, id) {
  const set = getCropPresetSetById(db, id);
  if (!set || set.apiKey !== apiKey) return null;
  setCropConfig(db, apiKey, { activeSetId: id });
  return getCropConfig(db, apiKey);
=======
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
  const hasMixer = mixerId !== null || mixerInput !== null;
  const hasCamera = cameraId !== null;
  if (!hasMixer && !hasCamera) {
    return { ok: false, error: 'At least one of mixerId/mixerInput or cameraId must be set' };
  }
  const id = randomUUID();
  db.prepare('INSERT INTO crop_source_map (id, api_key, mixer_id, mixer_input, camera_id, camera_preset, preset_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, apiKey, mixerId, mixerInput, cameraId, cameraPreset, presetId);
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
        if (row.camera_preset !== cameraPreset) continue;
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
>>>>>>> origin/main
}
