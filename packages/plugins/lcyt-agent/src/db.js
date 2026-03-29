/**
 * Database migrations and helpers for the lcyt-agent plugin.
 *
 * Tables:
 * - agent_events: log of AI agent actions (scene descriptions, event detections)
 * - agent_context: persistent context entries for AI understanding
 */

/**
 * Run DB migrations for agent tables.
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      description TEXT,
      confidence REAL DEFAULT 0,
      context_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_events_api_key
      ON agent_events(api_key);

    CREATE TABLE IF NOT EXISTS agent_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL,
      context_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_context_api_key
      ON agent_context(api_key);
  `);
}

/**
 * Insert an agent event record.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {object} event
 */
export function insertAgentEvent(db, apiKey, event) {
  const stmt = db.prepare(`
    INSERT INTO agent_events (api_key, event_type, description, confidence, context_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    apiKey,
    event.event_type || 'unknown',
    event.description || '',
    event.confidence || 0,
    JSON.stringify(event.context || {}),
  );
}

/**
 * Get recent agent events for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} [limit=50]
 * @returns {Array<object>}
 */
export function getRecentAgentEvents(db, apiKey, limit = 50) {
  const stmt = db.prepare(`
    SELECT * FROM agent_events
    WHERE api_key = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  return stmt.all(apiKey, limit);
}
