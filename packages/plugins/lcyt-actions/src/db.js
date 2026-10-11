/**
 * Named Actions plugin — DB helpers.
 *
 * A named action is a project-scoped, reusable composite of metacode "atoms"
 * (see docs/plans/plan_named_actions.md). The backend is pure storage: the
 * `definition` is the raw composite expression string (e.g.
 * `audio:start | graphics:+banner | @other`); parsing/expansion/execution all
 * live client-side (`packages/lcyt-web/src/lib/metacode-actions.js`).
 *
 * The action_defs table is part of lcyt-backend's schema. Every function takes the Prisma
 * client returned by lcyt-backend's initDb() and returns a Promise.
 */

/**
 * No-op: action_defs comes from lcyt-backend's schema. Kept so existing callers keep working.
 * @param {object} [_db] Prisma client (unused)
 */
export async function runActionsMigrations(_db) {}

/** @param {import('lcyt-backend/db').Db} db Prisma client @param {string} apiKey */
export async function listActionDefs(db, apiKey) {
  return db.action_defs.findMany({ where: { api_key: apiKey }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
}

/** @param {import('lcyt-backend/db').Db} db Prisma client */
export async function getActionDefBySlug(db, apiKey, slug) {
  return (await db.action_defs.findUnique({ where: { api_key_slug: { api_key: apiKey, slug } } })) ?? undefined;
}

/** @param {import('lcyt-backend/db').Db} db Prisma client */
export async function getActionDefById(db, id) {
  return (await db.action_defs.findUnique({ where: { id } })) ?? undefined;
}

/** @param {import('lcyt-backend/db').Db} db Prisma client */
export async function createActionDef(db, apiKey, { id, name, slug, definition, description }) {
  const now = db.$util.sqlNow();
  await db.action_defs.create({
    data: {
      id, api_key: apiKey, name, slug,
      definition: definition ?? '',
      description: description ?? null,
      created_at: now, updated_at: now,
    },
  });
  return getActionDefById(db, id);
}

/** @param {import('lcyt-backend/db').Db} db Prisma client */
export async function updateActionDef(db, id, fields) {
  const existing = await getActionDefById(db, id);
  if (!existing) return null;
  const next = {
    name: fields.name !== undefined ? fields.name : existing.name,
    slug: fields.slug !== undefined ? fields.slug : existing.slug,
    definition: fields.definition !== undefined ? fields.definition : existing.definition,
    description: fields.description !== undefined ? fields.description : existing.description,
  };
  await db.action_defs.updateMany({
    where: { id },
    data: {
      name: next.name, slug: next.slug, definition: next.definition ?? '',
      description: next.description ?? null, updated_at: db.$util.sqlNow(),
    },
  });
  return getActionDefById(db, id);
}

/** @param {import('lcyt-backend/db').Db} db Prisma client */
export async function deleteActionDef(db, id) {
  return (await db.action_defs.deleteMany({ where: { id } })).count > 0;
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
