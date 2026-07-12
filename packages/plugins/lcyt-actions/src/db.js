/**
 * Named Actions plugin — DB migrations and CRUD helpers.
 *
 * A named action is a project-scoped, reusable composite of metacode "atoms"
 * (see docs/plans/plan_named_actions.md). The backend is pure storage: the
 * `definition` is the raw composite expression string (e.g.
 * `audio:start | graphics:+banner | @other`); parsing/expansion/execution all
 * live client-side (`packages/lcyt-web/src/lib/metacode-actions.js`).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runActionsMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS action_defs (
      id          TEXT    PRIMARY KEY,
      api_key     TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      slug        TEXT    NOT NULL,            -- @-addressable; unique per api_key
      definition  TEXT    NOT NULL DEFAULT '', -- raw composite expression string
      description TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, slug)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_action_defs_key ON action_defs(api_key)`);
}

export function listActionDefs(db, apiKey) {
  return db.prepare('SELECT * FROM action_defs WHERE api_key = ? ORDER BY name').all(apiKey);
}

export function getActionDefBySlug(db, apiKey, slug) {
  return db.prepare('SELECT * FROM action_defs WHERE api_key = ? AND slug = ?').get(apiKey, slug);
}

export function getActionDefById(db, id) {
  return db.prepare('SELECT * FROM action_defs WHERE id = ?').get(id);
}

export function createActionDef(db, apiKey, { id, name, slug, definition, description }) {
  db.prepare(`
    INSERT INTO action_defs (id, api_key, name, slug, definition, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, apiKey, name, slug, definition ?? '', description ?? null);
  return getActionDefById(db, id);
}

export function updateActionDef(db, id, fields) {
  const existing = getActionDefById(db, id);
  if (!existing) return null;
  const next = {
    name: fields.name !== undefined ? fields.name : existing.name,
    slug: fields.slug !== undefined ? fields.slug : existing.slug,
    definition: fields.definition !== undefined ? fields.definition : existing.definition,
    description: fields.description !== undefined ? fields.description : existing.description,
  };
  db.prepare(`
    UPDATE action_defs
    SET name = ?, slug = ?, definition = ?, description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.name, next.slug, next.definition ?? '', next.description ?? null, id);
  return getActionDefById(db, id);
}

export function deleteActionDef(db, id) {
  return db.prepare('DELETE FROM action_defs WHERE id = ?').run(id).changes > 0;
}

/** Shape an action_defs row for a JSON response. */
export function serializeActionDef(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    definition: row.definition ?? '',
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
