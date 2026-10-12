/**
 * Cue Engine plugin — DB helpers.
 *
 * Tables (defined in lcyt-backend's schema: prisma/sqlite/schema.sql, prisma/postgres/migrations):
 *   cue_rules              — persistent trigger rules (phrase match, regex, section match, composite, track)
 *   cue_events             — log of fired cue events (ts = seconds since epoch)
 *   cue_named_conditions   — reusable named condition trees (Phase 9, referenced via `@name`/`ref` leaves)
 *
 * Every function takes the Prisma client returned by lcyt-backend's initDb() and returns a Promise.
 */

/**
 * No-op: the cue tables are part of lcyt-backend's schema. Kept so existing callers keep working.
 * @param {object} [_db] Prisma client (unused)
 */
export async function runMigrations(_db) {}

// ---------------------------------------------------------------------------
// Rule CRUD
// ---------------------------------------------------------------------------

/**
 * List all cue rules for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<Array<object>>}
 */
export async function listCueRules(db, apiKey) {
  return db.cue_rules.findMany({ where: { api_key: apiKey }, orderBy: { created_at: 'asc' } });
}

/**
 * Get a single cue rule by ID.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getCueRule(db, id) {
  return (await db.cue_rules.findUnique({ where: { id } })) ?? undefined;
}

/**
 * Insert a new cue rule.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {object} rule
 */
export async function insertCueRule(db, rule) {
  await db.cue_rules.create({
    data: {
      id: rule.id,
      api_key: rule.api_key,
      name: rule.name,
      match_type: rule.match_type,
      pattern: rule.pattern,
      action: JSON.stringify(rule.action ?? {}),
      enabled: rule.enabled ?? 1,
      cooldown_ms: rule.cooldown_ms ?? 0,
      fuzzy_threshold: rule.fuzzy_threshold ?? 0.75,
      condition_tree: rule.condition_tree !== undefined ? JSON.stringify(rule.condition_tree) : null,
      created_at: db.$util.sqlNow(),
    },
  });
}

/**
 * Update a cue rule.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} id
 * @param {object} fields — any subset of { name, match_type, pattern, action, enabled, cooldown_ms, condition_tree }
 */
export async function updateCueRule(db, id, fields) {
  const data = {};
  for (const key of ['name', 'match_type', 'pattern', 'enabled', 'cooldown_ms', 'fuzzy_threshold']) {
    if (fields[key] !== undefined) data[key] = fields[key];
  }
  if (fields.action !== undefined) data.action = JSON.stringify(fields.action);
  if (fields.condition_tree !== undefined) {
    data.condition_tree = fields.condition_tree === null ? null : JSON.stringify(fields.condition_tree);
  }
  if (Object.keys(data).length === 0) return;
  await db.cue_rules.updateMany({ where: { id }, data });
}

/**
 * Delete a cue rule.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} id
 */
export async function deleteCueRule(db, id) {
  await db.cue_rules.deleteMany({ where: { id } });
}

// ---------------------------------------------------------------------------
// Named condition CRUD (Phase 9)
// ---------------------------------------------------------------------------

/**
 * List all named conditions for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<Array<object>>}
 */
export async function listNamedConditions(db, apiKey) {
  return db.cue_named_conditions.findMany({ where: { api_key: apiKey }, orderBy: { created_at: 'asc' } });
}

/**
 * Get a single named condition by ID.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getNamedCondition(db, id) {
  return (await db.cue_named_conditions.findUnique({ where: { id } })) ?? undefined;
}

/**
 * Get a single named condition by (api_key, name).
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {string} name
 * @returns {Promise<object|undefined>}
 */
export async function getNamedConditionByName(db, apiKey, name) {
  return (await db.cue_named_conditions.findUnique({ where: { api_key_name: { api_key: apiKey, name } } })) ?? undefined;
}

/**
 * Insert a new named condition.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {{ id: string, api_key: string, name: string, condition_tree: object, source?: string }} cond
 */
export async function insertNamedCondition(db, cond) {
  await db.cue_named_conditions.create({
    data: {
      id: cond.id,
      api_key: cond.api_key,
      name: cond.name,
      condition_tree: JSON.stringify(cond.condition_tree),
      source: cond.source || 'api',
      created_at: db.$util.sqlNow(),
    },
  });
}

/**
 * Update a named condition.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} id
 * @param {object} fields — any subset of { name, condition_tree, source }
 */
export async function updateNamedCondition(db, id, fields) {
  const data = {};
  if (fields.name !== undefined) data.name = fields.name;
  if (fields.condition_tree !== undefined) data.condition_tree = JSON.stringify(fields.condition_tree);
  if (fields.source !== undefined) data.source = fields.source;
  if (Object.keys(data).length === 0) return;
  await db.cue_named_conditions.updateMany({ where: { id }, data });
}

/**
 * Delete a named condition.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} id
 */
export async function deleteNamedCondition(db, id) {
  await db.cue_named_conditions.deleteMany({ where: { id } });
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

/**
 * Insert a cue event (ts defaults to the current epoch second in the database).
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {{ rule_id: string, rule_name: string, matched?: string, action?: object }} event
 */
export async function insertCueEvent(db, apiKey, event) {
  await db.cue_events.create({
    data: {
      api_key: apiKey,
      rule_id: event.rule_id,
      rule_name: event.rule_name,
      matched: event.matched ?? null,
      action: JSON.stringify(event.action ?? {}),
    },
  });
}

/**
 * Retrieve the most recent cue events for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {number} [limit=50]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentCueEvents(db, apiKey, limit = 50) {
  return db.cue_events.findMany({
    where: { api_key: apiKey },
    select: { id: true, rule_id: true, rule_name: true, matched: true, action: true, ts: true },
    orderBy: [{ ts: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}
