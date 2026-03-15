/**
 * DB helpers for DSK graphics templates.
 *
 * Table: dsk_templates
 *   id           INTEGER PK
 *   api_key      TEXT NOT NULL
 *   name         TEXT NOT NULL           — user-defined label ("lower-third", "logo-bug")
 *   template_json TEXT NOT NULL          — serialised template JSON
 *   created_at   TEXT NOT NULL
 *   updated_at   TEXT NOT NULL
 */

/**
 * Insert or replace a template for an API key.
 * Returns the new row id.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey: string, name: string, templateJson: object }} opts
 * @returns {number}
 */
export function saveTemplate(db, { apiKey, name, templateJson }) {
  const json = JSON.stringify(templateJson);
  const existing = db.prepare(
    'SELECT id FROM dsk_templates WHERE api_key = ? AND name = ?'
  ).get(apiKey, name);

  if (existing) {
    db.prepare(
      "UPDATE dsk_templates SET template_json = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(json, existing.id);
    return existing.id;
  } else {
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO dsk_templates (api_key, name, template_json, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))"
    ).run(apiKey, name, json);
    return Number(lastInsertRowid);
  }
}

/**
 * Return all templates for an API key (id, name, updated_at — no JSON payload).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array<{ id: number, name: string, updated_at: string }>}
 */
export function listTemplates(db, apiKey) {
  return db.prepare(
    'SELECT id, name, updated_at FROM dsk_templates WHERE api_key = ? ORDER BY updated_at DESC'
  ).all(apiKey);
}

/**
 * Return a single template row including the JSON payload.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey  — must match; prevents cross-key access
 * @returns {{ id, name, templateJson: object, updated_at }|null}
 */
export function getTemplate(db, id, apiKey) {
  const row = db.prepare(
    'SELECT id, name, template_json, updated_at FROM dsk_templates WHERE id = ? AND api_key = ?'
  ).get(id, apiKey);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    templateJson: JSON.parse(row.template_json),
    updatedAt: row.updated_at,
  };
}

/**
 * Delete a template row.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {boolean}  true if a row was deleted
 */
export function deleteTemplate(db, id, apiKey) {
  const { changes } = db.prepare(
    'DELETE FROM dsk_templates WHERE id = ? AND api_key = ?'
  ).run(id, apiKey);
  return changes > 0;
}
