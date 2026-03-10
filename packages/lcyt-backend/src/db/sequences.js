// ---------------------------------------------------------------------------
// Per-API-key sequence helpers (persists sequence across sessions)
// ---------------------------------------------------------------------------

const KEY_SEQUENCE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Get the current sequence for an API key, respecting the 2-hour inactivity TTL.
 * Returns 0 (reset) if no captions have ever been sent or if the last caption was
 * sent more than 2 hours ago.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {number} The sequence to use for the next session
 */
export function getKeySequence(db, apiKey) {
  const row = db.prepare('SELECT sequence, last_caption_at FROM api_keys WHERE key = ?').get(apiKey);
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} sequence
 */
export function updateKeySequence(db, apiKey, sequence) {
  db.prepare(
    'UPDATE api_keys SET sequence = ?, last_caption_at = ? WHERE key = ?'
  ).run(sequence, new Date().toISOString(), apiKey);
}

/**
 * Explicitly reset the sequence for an API key to 0 and clear the
 * last-caption timestamp so the next session starts from the beginning.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function resetKeySequence(db, apiKey) {
  db.prepare(
    'UPDATE api_keys SET sequence = 0, last_caption_at = NULL WHERE key = ?'
  ).run(apiKey);
}
