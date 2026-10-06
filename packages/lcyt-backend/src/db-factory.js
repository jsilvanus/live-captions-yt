import { DbClient } from './db-client.js';

/**
 * Initialize DbClient with SQLite (Phase 1)
 * @param {string} [dbPath] - Path to SQLite database file
 * @returns {DbClient}
 */
export function initDbClient(dbPath) {
  // Re-export for convenience
  return DbClient;
}

export { DbClient };
