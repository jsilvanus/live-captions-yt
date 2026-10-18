/**
 * Tally plugin — DB helpers for the tally_lights table (part of lcyt-backend's schema).
 *
 * The source and output configs are stored as JSON text; `validate.js` is the
 * only place that decides what they may contain.
 */

/** @param {import('lcyt-backend/db').Db} db */
export async function listLights(db, apiKey) {
  return db.tally_lights.findMany({ where: { api_key: apiKey }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
}

/** Every light of every project; the manager starts them all at boot. */
export async function listAllLights(db) {
  return db.tally_lights.findMany({ orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
}

export async function listLightsForBridge(db, bridgeInstanceId) {
  return db.tally_lights.findMany({ where: { bridge_instance_id: bridgeInstanceId, enabled: 1 }, orderBy: { id: 'asc' } });
}

export async function getLight(db, apiKey, id) {
  return (await db.tally_lights.findFirst({ where: { id, api_key: apiKey } })) ?? undefined;
}

export async function createLight(db, apiKey, id, cfg) {
  const now = db.$util.sqlNow();
  await db.tally_lights.create({ data: { id, api_key: apiKey, ...configToColumns(cfg), created_at: now, updated_at: now } });
  return getLight(db, apiKey, id);
}

export async function updateLight(db, apiKey, id, cfg) {
  const res = await db.tally_lights.updateMany({
    where: { id, api_key: apiKey },
    data: { ...configToColumns(cfg), updated_at: db.$util.sqlNow() },
  });
  return res.count > 0 ? getLight(db, apiKey, id) : null;
}

export async function deleteLight(db, apiKey, id) {
  return (await db.tally_lights.deleteMany({ where: { id, api_key: apiKey } })).count > 0;
}

function configToColumns(cfg) {
  return {
    name: cfg.name,
    kind: cfg.kind,
    enabled: cfg.enabled === false ? 0 : 1,
    runner: cfg.runner ?? 'auto',
    bridge_instance_id: cfg.bridgeInstanceId ?? null,
    source_json: JSON.stringify(cfg.source),
    output_json: JSON.stringify(cfg.output),
    look_json: cfg.look ? JSON.stringify(cfg.look) : null,
  };
}

/** A tally_lights row as a validated-shape light config. */
export function rowToConfig(row) {
  const cfg = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    enabled: Number(row.enabled) !== 0,
    runner: row.runner,
    source: JSON.parse(row.source_json),
    output: JSON.parse(row.output_json),
  };
  if (row.bridge_instance_id) cfg.bridgeInstanceId = row.bridge_instance_id;
  if (row.look_json) cfg.look = JSON.parse(row.look_json);
  return cfg;
}
