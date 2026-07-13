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
      active_preset_id TEXT,
      x_norm          REAL NOT NULL DEFAULT 0.5,
      y_norm          REAL NOT NULL DEFAULT 0.0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
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
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
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
}
