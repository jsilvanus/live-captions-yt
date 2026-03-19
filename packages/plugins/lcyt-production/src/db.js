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

  // Additive migrations: add connection_source to cameras/mixers if missing
  const cameraCols = db.prepare("PRAGMA table_info(prod_cameras)").all().map(c => c.name);
  if (!cameraCols.includes('connection_source')) {
    db.exec("ALTER TABLE prod_cameras ADD COLUMN connection_source TEXT NOT NULL DEFAULT 'backend'");
  }

  const mixerCols = db.prepare("PRAGMA table_info(prod_mixers)").all().map(c => c.name);
  if (!mixerCols.includes('connection_source')) {
    db.exec("ALTER TABLE prod_mixers ADD COLUMN connection_source TEXT NOT NULL DEFAULT 'backend'");
  }
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
