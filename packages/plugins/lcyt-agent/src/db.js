/**
 * Database helpers for the lcyt-agent plugin (Prisma client from lcyt-backend's initDb()).
 *
 * Tables (created by the backend schema, not by the plugin):
 * - agent_events: log of AI agent actions (scene descriptions, event detections)
 * - agent_context: persistent context entries for AI understanding
 */

/** No-op kept for old callers: the tables come from the backend schema. */
export async function runMigrations() {}

/**
 * Insert an agent event record.
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @param {object} event
 */
export async function insertAgentEvent(db, apiKey, event) {
  await db.agent_events.create({
    data: {
      api_key: apiKey,
      event_type: event.event_type || 'unknown',
      description: event.description || '',
      confidence: event.confidence || 0,
      context_json: JSON.stringify(event.context || {}),
    },
  });
}

/**
 * Get recent agent events for an API key.
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @param {number} [limit=50]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentAgentEvents(db, apiKey, limit = 50) {
  return db.agent_events.findMany({
    where: { api_key: apiKey },
    orderBy: { id: 'desc' },
    take: limit,
  });
}
