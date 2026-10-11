/**
 * Production control DB helpers.
 *
 * Every function takes the Prisma client returned by lcyt-backend's initDb() and is async. The tables
 * (prod_*, bridge_security_rules) come from lcyt-backend's schema (prisma/sqlite/schema.sql for SQLite,
 * prisma/postgres/migrations for PostgreSQL), so there is nothing to migrate here.
 */

/** Kept for old callers: the tables now come from the backend schema, so this does nothing. */
export async function runMigrations(_db) {}

// ---------------------------------------------------------------------------
// bridge_security_rules CRUD
// ---------------------------------------------------------------------------

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} bridgeInstanceId
 * @param {'ip'|'command'} [ruleKind]  Omit to return both kinds.
 * @returns {Promise<Array<object>>}
 */
export async function listBridgeSecurityRules(db, bridgeInstanceId, ruleKind = null) {
  return db.bridge_security_rules.findMany({
    where: ruleKind ? { bridge_instance_id: bridgeInstanceId, rule_kind: ruleKind } : { bridge_instance_id: bridgeInstanceId },
    orderBy: { created_at: 'asc' },
  });
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {{ id: string, bridgeInstanceId: string, ruleKind: 'ip'|'command', ruleType: 'allow'|'deny', pattern: string, description?: string }} row
 * @returns {Promise<object>}  the inserted row
 */
export async function createBridgeSecurityRule(db, { id, bridgeInstanceId, ruleKind, ruleType, pattern, description = null }) {
  return db.bridge_security_rules.create({
    data: { id, bridge_instance_id: bridgeInstanceId, rule_kind: ruleKind, rule_type: ruleType, pattern, description },
  });
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function getBridgeSecurityRule(db, id) {
  return (await db.bridge_security_rules.findUnique({ where: { id } })) ?? undefined;
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} id
 * @returns {Promise<boolean>}  true if a row was deleted
 */
export async function deleteBridgeSecurityRule(db, id) {
  const result = await db.bridge_security_rules.deleteMany({ where: { id } });
  return result.count > 0;
}

/**
 * Seed the database with example cameras for development.
 * Only inserts if no cameras exist yet.
 * @param {import('lcyt-backend/db').Db} db
 */
export async function seedDevData(db) {
  const count = await db.prod_cameras.count();
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

  await db.$transaction(async (tx) => {
    for (const r of cameras) await tx.prod_cameras.create({ data: r });
  });
}
