// ---------------------------------------------------------------------------
// Per-API-key sequence helpers (persists sequence across sessions)
// ---------------------------------------------------------------------------

const KEY_SEQUENCE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Get the current sequence for an API key, respecting the 2-hour inactivity TTL.
 * Returns 0 (reset) if no captions have ever been sent or if the last caption was
 * sent more than 2 hours ago.
 *
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<number>} The sequence to use for the next session
 */
export async function getKeySequence(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { sequence: true, last_caption_at: true } });
  if (!row) return 0;
  if (!row.last_caption_at) return 0;
  const lastTs = new Date(row.last_caption_at).getTime();
  if (isNaN(lastTs) || Date.now() - lastTs > KEY_SEQUENCE_TTL_MS) return 0;
  return row.sequence || 0;
}

/**
 * Persist the latest sequence number for an API key and record when the last
 * caption was sent (used for the 2-hour auto-reset TTL).
 *
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} sequence
 * @returns {Promise<void>}
 */
export async function updateKeySequence(db, apiKey, sequence) {
  await db.api_keys.updateMany({
    where: { key: apiKey },
    data: { sequence, last_caption_at: new Date().toISOString() },
  });
}

/**
 * Explicitly reset the sequence for an API key to 0 and clear the
 * last-caption timestamp so the next session starts from the beginning.
 *
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
export async function resetKeySequence(db, apiKey) {
  await db.api_keys.updateMany({ where: { key: apiKey }, data: { sequence: 0, last_caption_at: null } });
}
