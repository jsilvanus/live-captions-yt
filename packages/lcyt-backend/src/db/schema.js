import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'lcyt-backend.db');

/**
 * Open/create the SQLite database and ensure the api_keys and caption_usage tables exist.
 * Runs additive migrations for new columns (safe to call on existing databases).
 * @param {string} [dbPath] - Path to the SQLite database file. Defaults to DB_PATH env var or ./lcyt-backend.db
 * @returns {import('better-sqlite3').Database}
 */
export function initDb(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || DEFAULT_DB_PATH;
  const db = new Database(resolvedPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      name          TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      active        INTEGER NOT NULL DEFAULT 1,
      is_admin      INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      key            TEXT    NOT NULL UNIQUE,
      owner          TEXT    NOT NULL,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at     TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      email          TEXT,
      daily_limit    INTEGER,
      lifetime_limit INTEGER,
      lifetime_used  INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      slug          TEXT    NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_members (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT    NOT NULL DEFAULT 'member',
      invited_by  INTEGER REFERENCES users(id),
      joined_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, user_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_feature_policies (
      feature_code TEXT    PRIMARY KEY,
      mode         TEXT    NOT NULL DEFAULT 'denied',
      updated_by   INTEGER REFERENCES users(id),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_feature_overrides (
      org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      feature_code TEXT    NOT NULL,
      mode         TEXT    NOT NULL,
      set_by       INTEGER REFERENCES users(id),
      set_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (org_id, feature_code)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_org_feature_overrides_org ON org_feature_overrides(org_id)');

  // Seed the initial deployment-wide feature policies; these defaults can be overridden
  // through the admin routes and only apply when a policy row does not already exist.
  const seedFeaturePolicies = [
    ['captions', 'available'],
    ['viewer-target', 'available'],
    ['mic-lock', 'available'],
    ['stats', 'available'],
    ['translations', 'available'],
    ['embed', 'available'],
    ['files-local', 'available'],
    ['files-browser-local', 'available'],
    ['collaboration', 'self_service'],
    ['file-saving', 'self_service'],
    ['files-managed-bucket', 'self_service'],
    ['files-custom-bucket', 'self_service'],
    ['files-webdav', 'self_service'],
    ['graphics-client', 'self_service'],
    ['restream', 'self_service'],
    ['ingest', 'denied'],
    ['radio', 'denied'],
    ['hls-stream', 'denied'],
    ['preview', 'denied'],
    ['stt-server', 'denied'],
    ['device-control', 'denied'],
    ['graphics-server', 'denied'],
    ['cea-captions', 'denied'],
  ];
  const insertPolicyStmt = db.prepare(`
    INSERT INTO site_feature_policies (feature_code, mode)
    VALUES (?, ?)
    ON CONFLICT(feature_code) DO NOTHING
  `);
  db.transaction(() => {
    for (const [featureCode, mode] of seedFeaturePolicies) {
      insertPolicyStmt.run(featureCode, mode);
    }
  })();

  // Additive migrations for databases created before the org index additions
  const existingOrgMemberIndexes = new Set(
    db.prepare('PRAGMA index_list(org_members)').all().map(index => index.name)
  );
  if (!existingOrgMemberIndexes.has('idx_org_members_user')) {
    db.exec('CREATE INDEX idx_org_members_user ON org_members(user_id)');
  }
  if (!existingOrgMemberIndexes.has('idx_org_members_org')) {
    db.exec('CREATE INDEX idx_org_members_org ON org_members(org_id)');
  }

  // Additive migrations for databases created before limit/email columns were added
  const existingCols = new Set(
    db.prepare('PRAGMA table_info(api_keys)').all().map(c => c.name)
  );
  if (!existingCols.has('email'))          db.exec('ALTER TABLE api_keys ADD COLUMN email TEXT');
  if (!existingCols.has('daily_limit'))    db.exec('ALTER TABLE api_keys ADD COLUMN daily_limit INTEGER');
  if (!existingCols.has('lifetime_limit')) db.exec('ALTER TABLE api_keys ADD COLUMN lifetime_limit INTEGER');
  if (!existingCols.has('lifetime_used'))  db.exec('ALTER TABLE api_keys ADD COLUMN lifetime_used INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('revoked_at')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN revoked_at TEXT');
    db.exec("UPDATE api_keys SET revoked_at = datetime('now') WHERE active = 0");
  }
  if (!existingCols.has('sequence'))        db.exec('ALTER TABLE api_keys ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('last_caption_at')) db.exec('ALTER TABLE api_keys ADD COLUMN last_caption_at TEXT');
  // 0 = disabled (default/free tier), 1 = enabled (allows per-session file saving via /file endpoint)
  if (!existingCols.has('backend_file_enabled')) db.exec('ALTER TABLE api_keys ADD COLUMN backend_file_enabled INTEGER NOT NULL DEFAULT 0');
  // 0 = graphics upload disabled (default), 1 = enabled (allows image upload via /images)
  if (!existingCols.has('graphics_enabled'))  db.exec('ALTER TABLE api_keys ADD COLUMN graphics_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('user_id'))           db.exec('ALTER TABLE api_keys ADD COLUMN user_id INTEGER REFERENCES users(id)');
  if (!existingCols.has('org_id'))            db.exec('ALTER TABLE api_keys ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
  // RTMP/relay extension columns (used by lcyt-rtmp plugin; kept here so createKey always works)
  if (!existingCols.has('relay_allowed'))     db.exec('ALTER TABLE api_keys ADD COLUMN relay_allowed INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('relay_active'))      db.exec('ALTER TABLE api_keys ADD COLUMN relay_active INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('radio_enabled'))     db.exec('ALTER TABLE api_keys ADD COLUMN radio_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('hls_enabled'))       db.exec('ALTER TABLE api_keys ADD COLUMN hls_enabled INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('cea708_delay_ms'))   db.exec('ALTER TABLE api_keys ADD COLUMN cea708_delay_ms INTEGER NOT NULL DEFAULT 0');
  if (!existingCols.has('embed_cors'))        db.exec("ALTER TABLE api_keys ADD COLUMN embed_cors TEXT NOT NULL DEFAULT '*'");
  if (!existingCols.has('device_code'))       db.exec('ALTER TABLE api_keys ADD COLUMN device_code TEXT');
  // Rotatable RTMP ingest credential, decoupled from the api_key itself.
  // NULL = the RTMP stream key is the api_key (today's behavior, unchanged).
  if (!existingCols.has('ingest_stream_key')) db.exec('ALTER TABLE api_keys ADD COLUMN ingest_stream_key TEXT');

  const existingApiKeyIndexes = new Set(
    db.prepare('PRAGMA index_list(api_keys)').all().map(index => index.name)
  );
  if (!existingApiKeyIndexes.has('idx_api_keys_org')) {
    db.exec('CREATE INDEX idx_api_keys_org ON api_keys(org_id)');
  }
  // SQLite ALTER TABLE ADD COLUMN cannot carry a UNIQUE constraint, so the
  // uniqueness of ingest_stream_key is enforced via a separate index instead.
  // NULLs are treated as distinct by SQLite's UNIQUE index, so any number of
  // keys may leave it unset.
  if (!existingApiKeyIndexes.has('idx_api_keys_ingest_stream_key')) {
    db.exec('CREATE UNIQUE INDEX idx_api_keys_ingest_stream_key ON api_keys(ingest_stream_key)');
  }

  // User-defined public slug replacing the raw api_key in user-facing URLs
  // (plan_dsk_viewport_settings Phase 1). NULL = slug URLs not enabled for
  // this project. Uniqueness via index (NULLs are distinct in SQLite).
  if (!existingCols.has('public_slug')) db.exec('ALTER TABLE api_keys ADD COLUMN public_slug TEXT');
  if (!existingApiKeyIndexes.has('idx_api_keys_public_slug')) {
    db.exec('CREATE UNIQUE INDEX idx_api_keys_public_slug ON api_keys(public_slug)');
  }

  // Additive migrations for organizations table
  const existingOrgCols = new Set(
    db.prepare('PRAGMA table_info(organizations)').all().map(c => c.name)
  );
  // 'none' | 'prefix' — when 'prefix', this org's projects must have
  // public_slugs starting with "<organizations.slug>-" (plan_dsk_viewport_settings Phase 1).
  if (!existingOrgCols.has('project_slug_policy')) {
    db.exec("ALTER TABLE organizations ADD COLUMN project_slug_policy TEXT NOT NULL DEFAULT 'none'");
  }

  // Additive migrations for users table
  const existingUserCols = new Set(
    db.prepare('PRAGMA table_info(users)').all().map(c => c.name)
  );
  if (!existingUserCols.has('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_usage (
      api_key TEXT NOT NULL,
      date    TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (api_key, date)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_rollups (
      api_key      TEXT NOT NULL,
      period_start TEXT NOT NULL,
      grain        TEXT NOT NULL DEFAULT 'hour',
      metric       TEXT NOT NULL,
      value        REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (api_key, metric, grain, period_start)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_usage_rollups_period ON usage_rollups(period_start)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_usage_rollups_metric ON usage_rollups(metric, period_start)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      actor       TEXT NOT NULL,
      actor_kind  TEXT NOT NULL,
      actor_id    TEXT,
      user_id     INTEGER,
      api_key     TEXT,
      org_id      INTEGER,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      details     TEXT,
      ip          TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(api_key, id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)');

  // One-time migration: fold the legacy admin-only audit trail into the
  // unified audit_log, then drop it (plan_metering_audit §5.4).
  const adminAuditTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit_log'").get();
  if (adminAuditTableExists) {
    const legacyRows = db.prepare(`
      SELECT actor, action, target_type, target_id, details, ip, created_at
      FROM admin_audit_log
    `).all();
    if (legacyRows.length > 0) {
      const insertLegacy = db.prepare(`
        INSERT INTO audit_log (created_at, actor, actor_kind, action, target_type, target_id, details, ip)
        VALUES (?, ?, 'admin', ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const row of legacyRows) {
          // Legacy datetime('now') format is 'YYYY-MM-DD HH:MM:SS' — normalise
          // to the audit_log ISO shape so sorting and range filters stay sane.
          const createdAt = row.created_at
            ? (row.created_at.includes('T') ? row.created_at : `${row.created_at.replace(' ', 'T')}Z`)
            : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
          insertLegacy.run(createdAt, row.actor || 'admin', row.action, row.target_type, row.target_id, row.details, row.ip);
        }
      })();
    }
    db.exec('DROP TABLE admin_audit_log');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_stats (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL,
      api_key         TEXT NOT NULL,
      domain          TEXT,
      started_at      TEXT NOT NULL,
      ended_at        TEXT NOT NULL,
      duration_ms     INTEGER NOT NULL,
      captions_sent   INTEGER NOT NULL DEFAULT 0,
      captions_failed INTEGER NOT NULL DEFAULT 0,
      final_sequence  INTEGER NOT NULL DEFAULT 0,
      ended_by        TEXT NOT NULL DEFAULT 'client'
    )
  `);

  // Sessions table: persistent session metadata and sequence counter
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id   TEXT PRIMARY KEY,
      api_key      TEXT,
      stream_key   TEXT,
      domain       TEXT,
      sequence     INTEGER NOT NULL DEFAULT 0,
      started_at   TEXT,
      last_activity TEXT,
      sync_offset  INTEGER,
      mic_holder   TEXT,
      data         TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_errors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key     TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      timestamp   TEXT NOT NULL,
      error_code  INTEGER,
      error_msg   TEXT,
      batch_size  INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key    TEXT,
      event_type TEXT NOT NULL,
      timestamp  TEXT NOT NULL,
      domain     TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS domain_hourly_stats (
      date              TEXT    NOT NULL,
      hour              INTEGER NOT NULL,
      domain            TEXT    NOT NULL,
      sessions_started  INTEGER NOT NULL DEFAULT 0,
      sessions_ended    INTEGER NOT NULL DEFAULT 0,
      captions_sent     INTEGER NOT NULL DEFAULT 0,
      captions_failed   INTEGER NOT NULL DEFAULT 0,
      batches_sent      INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      peak_sessions     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, hour, domain)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_files (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key     TEXT    NOT NULL,
      session_id  TEXT,
      filename    TEXT    NOT NULL,
      lang        TEXT,
      format      TEXT    NOT NULL DEFAULT 'youtube',
      type        TEXT    NOT NULL DEFAULT 'captions',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      size_bytes  INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS icons (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key       TEXT    NOT NULL,
      filename      TEXT    NOT NULL,
      disk_filename TEXT    NOT NULL,
      mime_type     TEXT    NOT NULL DEFAULT 'image/png',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      size_bytes    INTEGER NOT NULL DEFAULT 0
    )
  `);

  // ── Broadcasts: first-class intra-project casting occasion ───────────────
  // (plan/broadcasts — a project casts many times; groups scheduling + linked
  // reusable assets, and produced content attaches back via broadcast_id.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id                   TEXT    PRIMARY KEY,
      api_key              TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      title                TEXT    NOT NULL DEFAULT '',
      description          TEXT,
      status               TEXT    NOT NULL DEFAULT 'draft',
      scheduled_start      TEXT,
      scheduled_end        TEXT,
      actual_start         TEXT,
      actual_end           TEXT,
      youtube_video_ids    TEXT,
      youtube_broadcast_id TEXT,
      rundown_file_id      INTEGER,
      record_enabled       INTEGER NOT NULL DEFAULT 0,
      archived_at          TEXT,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_broadcasts_api_key ON broadcasts(api_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_broadcasts_status  ON broadcasts(api_key, status)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id            TEXT PRIMARY KEY,
      api_key       TEXT NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      broadcast_id  TEXT,
      title         TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'recording',
      storage_type  TEXT NOT NULL DEFAULT 'local',
      storage_key   TEXT,
      duration_ms   INTEGER,
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      started_at    TEXT,
      ended_at      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_api_key ON videos(api_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_broadcast_id ON videos(broadcast_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_assets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      broadcast_id  TEXT    NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      asset_type    TEXT    NOT NULL,
      asset_ref     TEXT    NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(broadcast_id, asset_type, asset_ref)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_broadcast_assets_bid ON broadcast_assets(broadcast_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcast_files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      broadcast_id  TEXT    NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
      file_id       INTEGER NOT NULL REFERENCES caption_files(id) ON DELETE CASCADE,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(broadcast_id, file_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_broadcast_files_bid ON broadcast_files(broadcast_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_broadcast_files_fid ON broadcast_files(file_id)');

  // Additive: nullable broadcast_id on produced-content tables so a session,
  // its stats, and its caption files attach to the broadcast that made them.
  // (No FK — SQLite ALTER TABLE ADD COLUMN cannot add one; the delete helper
  // nulls these manually to keep produced content when a broadcast is removed.)
  const sessionsCols = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name));
  if (!sessionsCols.has('broadcast_id')) db.exec('ALTER TABLE sessions ADD COLUMN broadcast_id TEXT');
  const sessionStatsCols = new Set(db.prepare('PRAGMA table_info(session_stats)').all().map(c => c.name));
  if (!sessionStatsCols.has('broadcast_id')) db.exec('ALTER TABLE session_stats ADD COLUMN broadcast_id TEXT');
  const captionFilesCols = new Set(db.prepare('PRAGMA table_info(caption_files)').all().map(c => c.name));
  if (!captionFilesCols.has('broadcast_id')) db.exec('ALTER TABLE caption_files ADD COLUMN broadcast_id TEXT');

  const broadcastCols = new Set(db.prepare('PRAGMA table_info(broadcasts)').all().map(c => c.name));
  if (!broadcastCols.has('record_enabled')) db.exec('ALTER TABLE broadcasts ADD COLUMN record_enabled INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS viewer_key_daily_stats (
      date        TEXT    NOT NULL,
      api_key     TEXT    NOT NULL,
      viewer_key  TEXT    NOT NULL,
      views       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, api_key, viewer_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS viewer_anon_daily_stats (
      date  TEXT    PRIMARY KEY NOT NULL,
      views INTEGER NOT NULL DEFAULT 0
    )
  `);

  // ── Self-service config: caption targets + translation config ────────────
  // (plan/selfservice_config_backend §1 — promotes lcyt-web's localStorage-only
  // targetConfig.js/translationConfig.js into server-persisted, self-service CRUD.)

  db.exec(`
    CREATE TABLE IF NOT EXISTS caption_targets (
      id          TEXT    PRIMARY KEY,
      api_key     TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      type        TEXT    NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      stream_key  TEXT,
      url         TEXT,
      headers     TEXT,
      viewer_key  TEXT,
      no_batch    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_caption_targets_api_key ON caption_targets(api_key)');

  // Additive migration: per-viewer-target icon branding.
  // icon_id references an icons(id) row (nullable — no icon chosen); icon_enabled
  // is an explicit show/hide toggle so operators can turn branding off without
  // losing the selected icon. Only meaningful for type='viewer'.
  {
    const captionTargetsCols = new Set(
      db.prepare('PRAGMA table_info(caption_targets)').all().map(c => c.name)
    );
    if (!captionTargetsCols.has('icon_id')) {
      db.exec('ALTER TABLE caption_targets ADD COLUMN icon_id INTEGER');
    }
    if (!captionTargetsCols.has('icon_enabled')) {
      db.exec('ALTER TABLE caption_targets ADD COLUMN icon_enabled INTEGER NOT NULL DEFAULT 0');
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_vendor_config (
      api_key        TEXT PRIMARY KEY REFERENCES api_keys(key) ON DELETE CASCADE,
      vendor         TEXT NOT NULL DEFAULT 'mymemory',
      vendor_api_key TEXT,
      libre_url      TEXT,
      libre_key      TEXT,
      show_original  INTEGER NOT NULL DEFAULT 0,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_targets (
      id          TEXT    PRIMARY KEY,
      api_key     TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      enabled     INTEGER NOT NULL DEFAULT 1,
      lang        TEXT    NOT NULL,
      target      TEXT    NOT NULL,
      format      TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_translation_targets_api_key ON translation_targets(api_key)');

  // Additive migration: Phase 5 per-target routing and show_original
  // Add caption_target_id (nullable FK to caption_targets) for per-target routing
  // Add show_original (per-row, replaces the global vendor_config flag)
  {
    const translationTargetsCols = new Set(
      db.prepare('PRAGMA table_info(translation_targets)').all().map(c => c.name)
    );
    if (!translationTargetsCols.has('caption_target_id')) {
      db.exec('ALTER TABLE translation_targets ADD COLUMN caption_target_id TEXT REFERENCES caption_targets(id) ON DELETE SET NULL');
    }
    if (!translationTargetsCols.has('show_original')) {
      // Default new rows to the prior global vendor config value (0 = false)
      db.exec('ALTER TABLE translation_targets ADD COLUMN show_original INTEGER NOT NULL DEFAULT 0');
    }
  }

  // ── Richer projects: feature flags, membership, device roles ─────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_features (
      api_key      TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      feature_code TEXT    NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      config       TEXT,
      granted_by   INTEGER REFERENCES users(id),
      granted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (api_key, feature_code)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_features_key ON project_features(api_key)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_features (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      feature_code TEXT    NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      config       TEXT,
      granted_by   INTEGER REFERENCES users(id),
      granted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, feature_code)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_features_user ON user_features(user_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key      TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_level TEXT    NOT NULL DEFAULT 'member',
      invited_by   INTEGER REFERENCES users(id),
      joined_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, user_id)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_members_key  ON project_members(api_key)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_member_permissions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id   INTEGER NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
      permission  TEXT    NOT NULL,
      granted     INTEGER NOT NULL DEFAULT 1,
      UNIQUE (member_id, permission)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_device_roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key     TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
      role_type   TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      pin_hash    TEXT    NOT NULL,
      permissions TEXT    NOT NULL DEFAULT '[]',
      config      TEXT,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_device_roles_key ON project_device_roles(api_key)');

  // ── Personal MCP access tokens (plan/mcp) ─────────────────────────────────
  // Named, individually-revocable bearer tokens for external MCP clients
  // (Claude Desktop, Claude Code). Raw token is shown once at creation and
  // only its hash is stored — closer to a GitHub PAT list than to
  // api_keys.ingest_stream_key's single rotatable slot.

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key      TEXT NOT NULL,
      label        TEXT NOT NULL,
      token_hash   TEXT NOT NULL UNIQUE,
      user_id      INTEGER,
      project_id   TEXT,
      scopes       TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at   TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_mcp_tokens_key ON mcp_tokens(api_key)');

  // Additive columns for the Setup Hub "MCP access" card (plan/ai_model_registry):
  // a soft active/inactive toggle distinct from permanent revocation, plus
  // creator attribution for multi-user projects.
  {
    const mcpTokenCols = new Set(
      db.prepare('PRAGMA table_info(mcp_tokens)').all().map(c => c.name)
    );
    if (!mcpTokenCols.has('active'))             db.exec('ALTER TABLE mcp_tokens ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    if (!mcpTokenCols.has('created_by_user_id')) db.exec('ALTER TABLE mcp_tokens ADD COLUMN created_by_user_id INTEGER');
    if (!mcpTokenCols.has('created_by_name'))    db.exec("ALTER TABLE mcp_tokens ADD COLUMN created_by_name TEXT NOT NULL DEFAULT ''");
    if (!mcpTokenCols.has('user_id'))            db.exec('ALTER TABLE mcp_tokens ADD COLUMN user_id INTEGER');
    if (!mcpTokenCols.has('project_id'))         db.exec('ALTER TABLE mcp_tokens ADD COLUMN project_id TEXT');
    if (!mcpTokenCols.has('scopes'))             db.exec('ALTER TABLE mcp_tokens ADD COLUMN scopes TEXT');
  }

  // ── Event-bus audit log (plan_pubsub_event_bus) ───────────────────────────
  // Insert-only, curated-topic history of notable events published on the
  // shared EventBus. This is a human/debug audit trail, NOT a replay mechanism
  // for reconnecting subscribers (live delivery is best-effort broadcast) and
  // deliberately decoupled from AgentEngine's agent_context (prompt-shaping).
  // Only curated topics are logged — see db/bus-events.js — so high-frequency
  // topics never put a synchronous write on the hot path. `ts` is epoch ms
  // (matches the bus envelope's ts).
  db.exec(`
    CREATE TABLE IF NOT EXISTS bus_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id   TEXT,
      topic        TEXT NOT NULL,
      ts           INTEGER NOT NULL,
      payload_json TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_bus_events_project ON bus_events(project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bus_events_ts ON bus_events(ts)');

  // Back-fill project_features from legacy api_keys columns (idempotent)
  const DEFAULT_FEATURES = ['captions', 'viewer-target', 'mic-lock', 'stats', 'translations'];
  const LEGACY_FEATURE_MAP = [
    { col: 'relay_allowed',        code: 'ingest',          check: v => v === 1 },
    { col: 'radio_enabled',        code: 'radio',           check: v => v === 1 },
    { col: 'hls_enabled',          code: 'hls-stream',      check: v => v === 1 },
    { col: 'backend_file_enabled', code: 'file-saving',     check: v => v === 1 },
    { col: 'graphics_enabled',     code: 'graphics-server', check: v => v === 1 },
    { col: 'cea708_delay_ms',      code: 'cea-captions',    check: v => v > 0 },
  ];

  const upsertFeature = db.prepare(`
    INSERT INTO project_features (api_key, feature_code, enabled, config)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (api_key, feature_code) DO NOTHING
  `);
  const upsertUserFeature = db.prepare(`
    INSERT INTO user_features (user_id, feature_code, enabled)
    VALUES (?, ?, 1)
    ON CONFLICT (user_id, feature_code) DO NOTHING
  `);
  const upsertMember = db.prepare(`
    INSERT INTO project_members (api_key, user_id, access_level)
    VALUES (?, ?, 'owner')
    ON CONFLICT (api_key, user_id) DO NOTHING
  `);

  const allKeys = db.prepare('SELECT * FROM api_keys').all();
  const backfillTx = db.transaction(() => {
    for (const row of allKeys) {
      const hasAny = db.prepare('SELECT 1 FROM project_features WHERE api_key = ? LIMIT 1').get(row.key);
      if (!hasAny) {
        for (const code of DEFAULT_FEATURES) {
          upsertFeature.run(row.key, code, 1, null);
        }
        for (const { col, code, check } of LEGACY_FEATURE_MAP) {
          const val = row[col];
          if (check(val ?? 0)) {
            const config = code === 'cea-captions' ? JSON.stringify({ delay_ms: val }) : null;
            upsertFeature.run(row.key, code, 1, config);
          }
        }
        // embed: always present, config holds cors value
        upsertFeature.run(row.key, 'embed', 1, JSON.stringify({ cors: row.embed_cors ?? '*' }));
      }
      // Ensure owning user is a project member
      if (row.user_id) {
        upsertMember.run(row.key, row.user_id);
      }
    }

    // Back-fill user_features for all users (default entitlements)
    const allUsers = db.prepare('SELECT id FROM users').all();
    for (const u of allUsers) {
      const hasAny = db.prepare('SELECT 1 FROM user_features WHERE user_id = ? LIMIT 1').get(u.id);
      if (!hasAny) {
        for (const code of DEFAULT_FEATURES) {
          upsertUserFeature.run(u.id, code);
        }
        // embed is a default user entitlement
        upsertUserFeature.run(u.id, 'embed');
      }
    }
  });
  backfillTx();

  return db;
}
