/**
 * Cue Engine plugin — DB migrations and helpers.
 *
 * Tables:
 *   cue_rules   — persistent trigger rules (phrase match, regex, section match)
 *   cue_events  — log of fired cue events
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  // cue_rules — one row per trigger rule.
  // match_type: 'phrase' (substring/case-insensitive), 'regex', 'section' (section code match)
  // action: JSON describing what happens when the cue fires
  //   e.g. { "type": "event", "label": "prayer-start" }
  //   e.g. { "type": "metacode", "code": "section", "value": "Prayer" }
  db.exec(`
    CREATE TABLE IF NOT EXISTS cue_rules (
      id          TEXT PRIMARY KEY,
      api_key     TEXT NOT NULL,
      name        TEXT NOT NULL,
      match_type  TEXT NOT NULL DEFAULT 'phrase',
      pattern     TEXT NOT NULL,
      action      TEXT NOT NULL DEFAULT '{}',
      enabled     INTEGER NOT NULL DEFAULT 1,
      cooldown_ms INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS cue_rules_key
      ON cue_rules(api_key)
  `);

  // cue_events — log of fired cue events for audit/rundown export
  db.exec(`
    CREATE TABLE IF NOT EXISTS cue_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key     TEXT    NOT NULL,
      rule_id     TEXT    NOT NULL,
      rule_name   TEXT    NOT NULL,
      matched     TEXT,
      action      TEXT    NOT NULL DEFAULT '{}',
      ts          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS cue_events_key_ts
      ON cue_events(api_key, ts)
  `);
}

// ---------------------------------------------------------------------------
// Rule CRUD
// ---------------------------------------------------------------------------

/**
 * List all cue rules for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array<object>}
 */
export function listCueRules(db, apiKey) {
  return db.prepare('SELECT * FROM cue_rules WHERE api_key = ? ORDER BY created_at').all(apiKey);
}

/**
 * Get a single cue rule by ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object|undefined}
 */
export function getCueRule(db, id) {
  return db.prepare('SELECT * FROM cue_rules WHERE id = ?').get(id);
}

/**
 * Insert a new cue rule.
 * @param {import('better-sqlite3').Database} db
 * @param {object} rule
 */
export function insertCueRule(db, rule) {
  db.prepare(`
    INSERT INTO cue_rules (id, api_key, name, match_type, pattern, action, enabled, cooldown_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(rule.id, rule.api_key, rule.name, rule.match_type, rule.pattern,
         JSON.stringify(rule.action ?? {}), rule.enabled ?? 1, rule.cooldown_ms ?? 0);
}

/**
 * Update a cue rule.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {object} fields — any subset of { name, match_type, pattern, action, enabled, cooldown_ms }
 */
export function updateCueRule(db, id, fields) {
  const sets = [];
  const vals = [];
  for (const key of ['name', 'match_type', 'pattern', 'enabled', 'cooldown_ms']) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (fields.action !== undefined) {
    sets.push('action = ?');
    vals.push(JSON.stringify(fields.action));
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE cue_rules SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/**
 * Delete a cue rule.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
export function deleteCueRule(db, id) {
  db.prepare('DELETE FROM cue_rules WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

/**
 * Insert a cue event.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ rule_id: string, rule_name: string, matched?: string, action?: object }} event
 */
export function insertCueEvent(db, apiKey, event) {
  db.prepare(`
    INSERT INTO cue_events (api_key, rule_id, rule_name, matched, action)
    VALUES (?, ?, ?, ?, ?)
  `).run(apiKey, event.rule_id, event.rule_name, event.matched ?? null,
         JSON.stringify(event.action ?? {}));
}

/**
 * Retrieve the most recent cue events for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} [limit=50]
 * @returns {Array<object>}
 */
export function getRecentCueEvents(db, apiKey, limit = 50) {
  return db.prepare(`
    SELECT id, rule_id, rule_name, matched, action, ts
    FROM cue_events
    WHERE api_key = ?
    ORDER BY ts DESC
    LIMIT ?
  `).all(apiKey, limit);
}
