/**
 * Database migrations and helpers for the lcyt-rtmp plugin.
 *
 * Call runMigrations(db) once at startup (inside initRtmpControl) to ensure
 * the RTMP-related tables and api_keys columns exist.
 *
 * @param {import('better-sqlite3').Database} db
 */
import { runRadioMigrations } from './db/radio.js';
import { runCropMigrations } from './db/crop.js';

export function runMigrations(db) {
  runRadioMigrations(db);
  runCropMigrations(db);
  // ── api_keys additive columns ──────────────────────────────────────────────
  const existingCols = new Set(
    db.prepare('PRAGMA table_info(api_keys)').all().map(c => c.name)
  );
  if (!existingCols.has('relay_allowed'))     db.exec('ALTER TABLE api_keys ADD COLUMN relay_allowed INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('relay_active'))      db.exec('ALTER TABLE api_keys ADD COLUMN relay_active INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('radio_enabled'))     db.exec('ALTER TABLE api_keys ADD COLUMN radio_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('hls_enabled'))       db.exec('ALTER TABLE api_keys ADD COLUMN hls_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('cea708_delay_ms'))   db.exec('ALTER TABLE api_keys ADD COLUMN cea708_delay_ms INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('embed_cors'))        db.exec("ALTER TABLE api_keys ADD COLUMN embed_cors TEXT NOT NULL DEFAULT '*'");

  // ── rtmp_relays: one incoming stream fans out to up to 4 target URLs ────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rtmp_relays (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key      TEXT    NOT NULL,
      slot         INTEGER NOT NULL DEFAULT 1,
      target_url   TEXT    NOT NULL,
      target_name  TEXT,
      caption_mode TEXT    NOT NULL DEFAULT 'http',
      record_on_start INTEGER NOT NULL DEFAULT 0,
      record_on_button INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(api_key, slot)
    )
  `);

  // Migration: if rtmp_relays has the old single-target schema (no slot column),
  // recreate it with the fan-out schema (UNIQUE api_key → UNIQUE (api_key, slot)).
  {
    const relaysCols = new Set(
      db.prepare('PRAGMA table_info(rtmp_relays)').all().map(c => c.name)
    );
    if (!relaysCols.has('slot')) {
      db.transaction(() => {
        db.exec('ALTER TABLE rtmp_relays RENAME TO rtmp_relays_legacy');
        db.exec(`
          CREATE TABLE rtmp_relays (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            api_key      TEXT    NOT NULL,
            slot         INTEGER NOT NULL DEFAULT 1,
            target_url   TEXT    NOT NULL,
            target_name  TEXT,
            caption_mode TEXT    NOT NULL DEFAULT 'http',
            record_on_start INTEGER NOT NULL DEFAULT 0,
            record_on_button INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(api_key, slot)
          )
        `);
        const legacyCols = new Set(
          db.prepare('PRAGMA table_info(rtmp_relays_legacy)').all().map(c => c.name)
        );
        db.exec(`
          INSERT INTO rtmp_relays (api_key, slot, target_url, target_name, caption_mode, created_at, updated_at)
          SELECT api_key, 1, target_url,
                 ${legacyCols.has('target_name')  ? 'target_name'                 : 'NULL'},
                 ${legacyCols.has('caption_mode') ? "COALESCE(caption_mode,'http')" : "'http'"},
                 created_at, updated_at
          FROM rtmp_relays_legacy
        `);
        db.exec('DROP TABLE rtmp_relays_legacy');
      })();
    } else {
      if (!relaysCols.has('target_name'))  db.exec('ALTER TABLE rtmp_relays ADD COLUMN target_name TEXT');
      if (!relaysCols.has('caption_mode')) db.exec("ALTER TABLE rtmp_relays ADD COLUMN caption_mode TEXT NOT NULL DEFAULT 'http'");
    }
    // Per-slot transcoding options
    {
      const latestCols = new Set(
        db.prepare('PRAGMA table_info(rtmp_relays)').all().map(c => c.name)
      );
      if (!latestCols.has('scale'))         db.exec('ALTER TABLE rtmp_relays ADD COLUMN scale TEXT');
      if (!latestCols.has('fps'))           db.exec('ALTER TABLE rtmp_relays ADD COLUMN fps INTEGER');
      if (!latestCols.has('video_bitrate')) db.exec('ALTER TABLE rtmp_relays ADD COLUMN video_bitrate TEXT');
      if (!latestCols.has('audio_bitrate')) db.exec('ALTER TABLE rtmp_relays ADD COLUMN audio_bitrate TEXT');
      // Which rendition this slot forwards: 'program' (raw ingest, default)
      // or 'crop' (the {key}-crop vertical rendition — plan_vertical_crop.md)
      if (!latestCols.has('source_view'))   db.exec("ALTER TABLE rtmp_relays ADD COLUMN source_view TEXT NOT NULL DEFAULT 'program'");
      if (!latestCols.has('record_on_start')) db.exec('ALTER TABLE rtmp_relays ADD COLUMN record_on_start INTEGER NOT NULL DEFAULT 0');
      if (!latestCols.has('record_on_button')) db.exec('ALTER TABLE rtmp_relays ADD COLUMN record_on_button INTEGER NOT NULL DEFAULT 0');
      // Optional named-feed source (plan_ingest_feeds.md §1b): a prod_cameras.id.
      // When set, takes priority over source_view — the slot relays from that
      // camera's camera_key MediaMTX path instead of the raw per-key ingest.
      if (!latestCols.has('source_camera_id')) db.exec('ALTER TABLE rtmp_relays ADD COLUMN source_camera_id TEXT');
    }
  }

  // ── rtmp_stream_stats (per-stream, personified) ────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rtmp_stream_stats (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key       TEXT    NOT NULL,
      slot          INTEGER NOT NULL DEFAULT 1,
      target_url    TEXT    NOT NULL,
      target_name   TEXT,
      caption_mode  TEXT    NOT NULL DEFAULT 'http',
      started_at    TEXT    NOT NULL,
      ended_at      TEXT,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      captions_sent INTEGER NOT NULL DEFAULT 0
    )
  `);
  {
    const statsCols = new Set(
      db.prepare('PRAGMA table_info(rtmp_stream_stats)').all().map(c => c.name)
    );
    if (!statsCols.has('slot')) {
      db.exec('ALTER TABLE rtmp_stream_stats ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    }
  }

  // ── rtmp_anon_daily_stats (anonymous, no API key) ──────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rtmp_anon_daily_stats (
      date             TEXT    NOT NULL,
      endpoint_type    TEXT    NOT NULL,
      caption_mode     TEXT    NOT NULL DEFAULT 'http',
      streams_count    INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, endpoint_type, caption_mode)
    )
  `);

  // ── stt_config: per-key STT configuration ─────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS stt_config (
      api_key              TEXT PRIMARY KEY,
      provider             TEXT NOT NULL DEFAULT 'google',
      language             TEXT NOT NULL DEFAULT 'en-US',
      audio_source         TEXT NOT NULL DEFAULT 'hls',
      stream_key           TEXT,
      auto_start           INTEGER NOT NULL DEFAULT 0,
      confidence_threshold REAL,
      created_at           INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at           INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);
  // Additive migration: add confidence_threshold if missing (pre-Phase-4 databases)
  try {
    db.exec(`ALTER TABLE stt_config ADD COLUMN confidence_threshold REAL`);
  } catch {
    // Column already exists — ignore
  }

  // ── stt_source_languages: predefined per-project source language list ─────
  db.exec(`
    CREATE TABLE IF NOT EXISTS stt_source_languages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key    TEXT    NOT NULL,
      lang       TEXT    NOT NULL,
      label      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(api_key, lang)
    )
  `);
}

// ── STT config DB helpers ──────────────────────────────────────────────────

/**
 * Get STT config for an API key, or null if none exists.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ provider: string, language: string, audio_source: string, stream_key: string|null, auto_start: boolean }|null}
 */
export function getSttConfig(db, apiKey) {
  const row = db.prepare('SELECT * FROM stt_config WHERE api_key = ?').get(apiKey);
  if (!row) return null;
  return {
    provider:            row.provider,
    language:            row.language,
    audioSource:         row.audio_source,
    streamKey:           row.stream_key ?? null,
    autoStart:           Boolean(row.auto_start),
    confidenceThreshold: row.confidence_threshold ?? null,
  };
}

/**
 * Upsert STT config for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ provider?: string, language?: string, audioSource?: string, streamKey?: string|null, autoStart?: boolean }} opts
 */
export function setSttConfig(db, apiKey, { provider, language, audioSource, streamKey, autoStart, confidenceThreshold } = {}) {
  const existing = db.prepare('SELECT * FROM stt_config WHERE api_key = ?').get(apiKey);
  if (!existing) {
    db.prepare(`
      INSERT INTO stt_config (api_key, provider, language, audio_source, stream_key, auto_start, confidence_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      apiKey,
      provider    ?? 'google',
      language    ?? 'en-US',
      audioSource ?? 'hls',
      streamKey   ?? null,
      autoStart   ? 1 : 0,
      confidenceThreshold !== undefined ? (confidenceThreshold ?? null) : null,
    );
  } else {
    db.prepare(`
      UPDATE stt_config
      SET provider              = COALESCE(?, provider),
          language              = COALESCE(?, language),
          audio_source          = COALESCE(?, audio_source),
          stream_key            = ?,
          auto_start            = COALESCE(?, auto_start),
          confidence_threshold  = ?,
          updated_at            = strftime('%s','now')
      WHERE api_key = ?
    `).run(
      provider    ?? null,
      language    ?? null,
      audioSource ?? null,
      streamKey   !== undefined ? (streamKey ?? null) : existing.stream_key,
      autoStart   !== undefined ? (autoStart ? 1 : 0) : null,
      confidenceThreshold !== undefined ? (confidenceThreshold ?? null) : existing.confidence_threshold ?? null,
      apiKey,
    );
  }
}

// ── STT source languages DB helpers ────────────────────────────────────────

/**
 * Get all source languages for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array<{ id: number, lang: string, label?: string, sortOrder: number }>}
 */
export function getSttSourceLanguages(db, apiKey) {
  return db.prepare('SELECT id, lang, label, sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt FROM stt_source_languages WHERE api_key = ? ORDER BY sort_order, id')
    .all(apiKey)
    .map(row => ({
      id:        row.id,
      lang:      row.lang,
      label:     row.label ?? null,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
}

/**
 * Add a source language to the predefined list.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} lang - BCP-47 language code
 * @param {{ label?: string, sortOrder?: number }} opts
 * @returns {{ ok: true, language: object } | { ok: false, error: string }}
 */
export function addSttSourceLanguage(db, apiKey, lang, { label = null, sortOrder = null } = {}) {
  if (!lang || typeof lang !== 'string') {
    return { ok: false, error: 'lang is required' };
  }
  try {
    const existing = db.prepare('SELECT id FROM stt_source_languages WHERE api_key = ? AND lang = ?').get(apiKey, lang);
    if (existing) {
      return { ok: false, error: 'Language already in the list' };
    }
    const order = sortOrder !== undefined && sortOrder !== null ? sortOrder
      : (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM stt_source_languages WHERE api_key = ?').get(apiKey).next);

    db.prepare(`
      INSERT INTO stt_source_languages (api_key, lang, label, sort_order)
      VALUES (?, ?, ?, ?)
    `).run(apiKey, lang, label ?? null, order);

    const row = db.prepare('SELECT id, lang, label, sort_order as sortOrder FROM stt_source_languages WHERE api_key = ? AND lang = ?').get(apiKey, lang);
    return { ok: true, language: { id: row.id, lang: row.lang, label: row.label ?? null, sortOrder: row.sortOrder } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Update a source language entry.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} id
 * @param {{ label?: string, sortOrder?: number }} patch
 * @returns {{ ok: true, language: object } | { ok: false, error: string, status?: number }}
 */
export function updateSttSourceLanguage(db, apiKey, id, { label, sortOrder } = {}) {
  const existing = db.prepare('SELECT * FROM stt_source_languages WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) {
    return { ok: false, error: 'Language not found', status: 404 };
  }
  try {
    db.prepare(`
      UPDATE stt_source_languages
      SET label      = ?,
          sort_order = ?,
          updated_at = strftime('%s','now')
      WHERE api_key = ? AND id = ?
    `).run(
      label !== undefined ? label : existing.label,
      sortOrder ?? existing.sort_order,
      apiKey, id
    );
    const row = db.prepare('SELECT id, lang, label, sort_order as sortOrder FROM stt_source_languages WHERE api_key = ? AND id = ?').get(apiKey, id);
    return { ok: true, language: { id: row.id, lang: row.lang, label: row.label ?? null, sortOrder: row.sortOrder } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Remove a source language from the predefined list.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} id
 * @returns {boolean} true if a row was deleted
 */
export function deleteSttSourceLanguage(db, apiKey, id) {
  const result = db.prepare('DELETE FROM stt_source_languages WHERE api_key = ? AND id = ?').run(apiKey, id);
  return result.changes > 0;
}

export * from './db/relay.js';
export * from './db/radio.js';
export * from './db/crop.js';
