/**
 * Production control DB migrations.
 * Call runMigrations(db) with the better-sqlite3 Database instance from lcyt-backend.
 * All migrations are additive and idempotent — safe to run on existing databases.
 */

export function runMigrations(db) {
  // bridge_instances — each physical bridge agent (streaming computer)
  db.exec(`
    CREATE TABLE IF NOT EXISTS prod_bridge_instances (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      token       TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'disconnected',
      last_seen   TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // cameras — one row per physical camera
  db.exec(`
    CREATE TABLE IF NOT EXISTS prod_cameras (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      mixer_input         INTEGER,
      control_type        TEXT NOT NULL DEFAULT 'none',
      control_config      TEXT NOT NULL DEFAULT '{}',
      bridge_instance_id  TEXT REFERENCES prod_bridge_instances(id) ON DELETE SET NULL,
      sort_order          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // mixers — one row per physical mixer / switcher
  db.exec(`
    CREATE TABLE IF NOT EXISTS prod_mixers (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      type                TEXT NOT NULL,
      connection_config   TEXT NOT NULL DEFAULT '{}',
      bridge_instance_id  TEXT REFERENCES prod_bridge_instances(id) ON DELETE SET NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // encoders — one row per hardware encoder (e.g. Matrox Monarch HD/HDx)
  db.exec(`
    CREATE TABLE IF NOT EXISTS prod_encoders (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      type                TEXT NOT NULL,
      connection_config   TEXT NOT NULL DEFAULT '{}',
      connection_source   TEXT NOT NULL DEFAULT 'backend',
      bridge_instance_id  TEXT REFERENCES prod_bridge_instances(id) ON DELETE SET NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // bridge_security_rules — per-bridge TCP command / target IP allow-deny
  // policy. rule_kind distinguishes "IP/host the bridge may dial"
  // ('ip', pattern syntax mirrors lcyt-connectors' connector_network_rules:
  // exact host, *.example.com wildcard, exact IP, CIDR, optional :port) from
  // "TCP command payload the bridge may send" ('command', pattern is a
  // regex tested against the outgoing payload string). Evaluated by
  // bridge-security.js: any matching 'deny' rule blocks; else if any
  // 'allow' rule exists for that kind, only a matching 'allow' rule passes
  // (default-deny); else default-allow (no rules configured for that kind).
  db.exec(`
    CREATE TABLE IF NOT EXISTS bridge_security_rules (
      id                  TEXT PRIMARY KEY,
      bridge_instance_id  TEXT NOT NULL REFERENCES prod_bridge_instances(id) ON DELETE CASCADE,
      rule_kind           TEXT NOT NULL CHECK (rule_kind IN ('ip','command')),
      rule_type           TEXT NOT NULL CHECK (rule_type IN ('allow','deny')),
      pattern             TEXT NOT NULL,
      description         TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bridge_security_rules_instance
      ON bridge_security_rules(bridge_instance_id, rule_kind)
  `);

  // Additive migrations: add connection_source to cameras/mixers if missing
  const cameraCols = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols.includes('connection_source')) {
    db.exec("ALTER TABLE prod_cameras ADD COLUMN connection_source TEXT NOT NULL DEFAULT 'backend'");
  }

  const mixerCols = db.prepare("PRAGMA table_info(prod_mixers)").all().map(c => c.name);
  if (!mixerCols.includes('connection_source')) {
    db.exec("ALTER TABLE prod_mixers ADD COLUMN connection_source TEXT NOT NULL DEFAULT 'backend'");
  }

  // camera_key: MediaMTX path name for webcam/mobile cameras (e.g. 'myevent-cam1')
  const cameraCols2 = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols2.includes('camera_key')) {
    db.exec('ALTER TABLE prod_cameras ADD COLUMN camera_key TEXT');
  }

  // output_key: MediaMTX output path for LCYT software mixer output
  const mixerCols2 = db.prepare("PRAGMA table_info(prod_mixers)").all().map(c => c.name);
  if (!mixerCols2.includes('output_key')) {
    db.exec('ALTER TABLE prod_mixers ADD COLUMN output_key TEXT');
  }

  // thumbnail_captured_at: ISO timestamp of the last successful still-frame capture
  const cameraCols3 = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols3.includes('thumbnail_captured_at')) {
    db.exec('ALTER TABLE prod_cameras ADD COLUMN thumbnail_captured_at TEXT');
  }

  // owner_api_key: the project (api_keys.key) that created this camera, set
  // automatically from the now-real session/device auth on the CRUD routes
  // (plan_ingest_feeds.md's cross-tenant sourceCameraId review finding).
  // NULL for any camera created before this column existed, or via the
  // in-process crud.js path with no ownerApiKey supplied — those stay in the
  // pre-existing open/legacy bucket rather than becoming inaccessible.
  // No FK to api_keys (cross-plugin, mirrors the rest of this file's
  // no-hard-dependency convention) and no project scoping on prod_mixers/
  // prod_encoders yet — out of scope here, see CONSIDER.md.
  const cameraCols4 = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols4.includes('owner_api_key')) {
    db.exec('ALTER TABLE prod_cameras ADD COLUMN owner_api_key TEXT');
  }

  // label: free text describing the camera (e.g. 'pulpit', 'choir', 'wide')
  // zone: optional coarse tag for camera placement (front/back/left/right/wide)
  // overlap_links: JSON array of { cameraId, presetId?, kind: 'overlaps_with'|'alternate_for' }
  //   representing cameras/presets that can cover the same subject
  const cameraCols5 = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols5.includes('label')) {
    db.exec('ALTER TABLE prod_cameras ADD COLUMN label TEXT');
  }
  const cameraCols6 = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols6.includes('zone')) {
    db.exec('ALTER TABLE prod_cameras ADD COLUMN zone TEXT');
  }
  const cameraCols7 = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols7.includes('overlap_links')) {
    db.exec("ALTER TABLE prod_cameras ADD COLUMN overlap_links TEXT NOT NULL DEFAULT '[]'");
  }

  // mixer_id: which prod_mixers row mixer_input refers to. Nullable — NULL
  // means "unscoped/legacy" (every camera created before this column
  // existed, or a single-mixer deployment that never needed to
  // disambiguate). Added because mixer_input alone is only unique within
  // one mixer; a deployment with >1 mixer could otherwise have two
  // different cameras both claim input 3 with no way to tell them apart
  // (plan_video_perception.md Phase 3's shared-feed resolver is the first
  // consumer that actually needs this disambiguation — code-review finding).
  const cameraCols8 = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols8.includes('mixer_id')) {
    db.exec('ALTER TABLE prod_cameras ADD COLUMN mixer_id TEXT REFERENCES prod_mixers(id) ON DELETE SET NULL');
  }
}

// ---------------------------------------------------------------------------
// bridge_security_rules CRUD
// ---------------------------------------------------------------------------

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} bridgeInstanceId
 * @param {'ip'|'command'} [ruleKind]  Omit to return both kinds.
 * @returns {Array<object>}
 */
export function listBridgeSecurityRules(db, bridgeInstanceId, ruleKind = null) {
  if (ruleKind) {
    return db.prepare(
      'SELECT * FROM bridge_security_rules WHERE bridge_instance_id = ? AND rule_kind = ? ORDER BY created_at'
    ).all(bridgeInstanceId, ruleKind);
  }
  return db.prepare(
    'SELECT * FROM bridge_security_rules WHERE bridge_instance_id = ? ORDER BY created_at'
  ).all(bridgeInstanceId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, bridgeInstanceId: string, ruleKind: 'ip'|'command', ruleType: 'allow'|'deny', pattern: string, description?: string }} row
 * @returns {object}  the inserted row
 */
export function createBridgeSecurityRule(db, { id, bridgeInstanceId, ruleKind, ruleType, pattern, description = null }) {
  db.prepare(`
    INSERT INTO bridge_security_rules (id, bridge_instance_id, rule_kind, rule_type, pattern, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, bridgeInstanceId, ruleKind, ruleType, pattern, description);
  return db.prepare('SELECT * FROM bridge_security_rules WHERE id = ?').get(id);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object|undefined}
 */
export function getBridgeSecurityRule(db, id) {
  return db.prepare('SELECT * FROM bridge_security_rules WHERE id = ?').get(id);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {boolean}  true if a row was deleted
 */
export function deleteBridgeSecurityRule(db, id) {
  const result = db.prepare('DELETE FROM bridge_security_rules WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Seed the database with example cameras for development.
 * Only inserts if no cameras exist yet.
 * @param {import('better-sqlite3').Database} db
 */
export function seedDevData(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM prod_cameras').get().n;
  if (count > 0) return;

  const cameras = [
    {
      id: 'cam-altar',
      name: 'Altar',
      mixer_input: 1,
      control_type: 'amx',
      control_config: JSON.stringify({
        host: '192.168.2.50',
        port: 1319,
        presets: [
          { id: 'wide',  name: 'Wide',    command: "SEND_COMMAND dvCam1,'PRESET-1'" },
          { id: 'close', name: 'Close-up', command: "SEND_COMMAND dvCam1,'PRESET-2'" },
          { id: 'cross', name: 'Cross',   command: "SEND_COMMAND dvCam1,'PRESET-3'" },
        ],
      }),
      sort_order: 0,
    },
    {
      id: 'cam-pulpit',
      name: 'Pulpit',
      mixer_input: 2,
      control_type: 'amx',
      control_config: JSON.stringify({
        host: '192.168.2.50',
        port: 1319,
        presets: [
          { id: 'wide',  name: 'Wide',    command: "SEND_COMMAND dvCam2,'PRESET-1'" },
          { id: 'close', name: 'Close-up', command: "SEND_COMMAND dvCam2,'PRESET-2'" },
        ],
      }),
      sort_order: 1,
    },
    {
      id: 'cam-overview',
      name: 'Overview',
      mixer_input: 3,
      control_type: 'none',
      control_config: JSON.stringify({}),
      sort_order: 2,
    },
  ];

  const insert = db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order)
    VALUES (@id, @name, @mixer_input, @control_type, @control_config, @sort_order)
  `);
  const insertAll = db.transaction((rows) => rows.forEach(r => insert.run(r)));
  insertAll(cameras);
}
