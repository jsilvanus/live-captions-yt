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

// Recursively collect all string `id` values from a template JSON object.
function collectIdsFromObject(obj, out) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'id' && typeof v === 'string') out.add(v);
      else collectIdsFromObject(v, out);
    }
  }
}

/**
 * Find templates for an apiKey that contain any of the element ids present in
 * the provided `templateJson`. Returns an array of conflict objects
 * { id, name, overlapping: [ids...] } excluding `excludeTemplateId` when set.
 */
export function findTemplatesWithAnyElementIds(db, apiKey, templateJson, excludeTemplateId = null) {
  const ids = new Set();
  collectIdsFromObject(templateJson, ids);
  if (ids.size === 0) return [];

  const rows = db.prepare('SELECT id, name, template_json FROM dsk_templates WHERE api_key = ?').all(apiKey);
  const conflicts = [];
  for (const row of rows) {
    if (excludeTemplateId != null && Number(row.id) === Number(excludeTemplateId)) continue;
    let otherJson;
    try { otherJson = JSON.parse(row.template_json); } catch { continue; }
    const otherIds = new Set();
    collectIdsFromObject(otherJson, otherIds);
    const overlapping = [...ids].filter(x => otherIds.has(x));
    if (overlapping.length > 0) conflicts.push({ id: row.id, name: row.name, overlapping });
  }
  return conflicts;
}

/**
 * Produce a new template JSON where any element ids that collide with other
 * templates for the same apiKey are renamed. Returns { updatedTemplateJson, renameMap }
 * where renameMap maps originalId -> newId. The function ensures new ids do not
 * collide with existing template ids.
 */
export function autoRenameConflictingIds(db, apiKey, templateJson, excludeTemplateId = null) {
  const ids = new Set();
  collectIdsFromObject(templateJson, ids);
  if (ids.size === 0) return { updatedTemplateJson: templateJson, renameMap: {} };

  // Collect all existing ids from other templates
  const rows = db.prepare('SELECT id, template_json FROM dsk_templates WHERE api_key = ?').all(apiKey);
  const existingIds = new Set();
  for (const row of rows) {
    if (excludeTemplateId != null && Number(row.id) === Number(excludeTemplateId)) continue;
    try {
      const json = JSON.parse(row.template_json);
      collectIdsFromObject(json, existingIds);
    } catch {}
  }

  const renameMap = {};
  const used = new Set(existingIds);
  // also avoid collisions within the new template when renaming
  for (const id of ids) used.add(id);

  for (const orig of ids) {
    if (!existingIds.has(orig)) continue;
    // generate a stable suffix based on timestamp + counter
    let counter = 1;
    let candidate;
    do {
      candidate = `${orig}_r${counter}`;
      counter += 1;
    } while (used.has(candidate));
    renameMap[orig] = candidate;
    used.add(candidate);
  }

  if (Object.keys(renameMap).length === 0) return { updatedTemplateJson: templateJson, renameMap: {} };

  // Deep clone and apply renames
  const updated = JSON.parse(JSON.stringify(templateJson));
  function applyRenames(obj) {
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'id' && typeof v === 'string' && renameMap[v]) obj[k] = renameMap[v];
        else applyRenames(v);
      }
    }
  }
  applyRenames(updated);

  return { updatedTemplateJson: updated, renameMap };
}
