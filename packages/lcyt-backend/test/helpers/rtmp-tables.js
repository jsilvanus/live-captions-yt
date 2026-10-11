/**
 * lcyt-rtmp still runs synchronous SQL on the legacy better-sqlite3 handle (`db.$legacy`, SQLite only).
 * On PostgreSQL its tables already come from prisma/postgres/migrations/0001_init.sql.
 */
import { runMigrations } from 'lcyt-rtmp/src/db.js';

export function ensureRtmpTables(db) {
  if (db.$legacy) runMigrations(db.$legacy);
}

/** Pass as the `skip` option of describe/it: the plugin's db helpers have no PostgreSQL implementation yet. */
export const SQLITE_ONLY_PLUGIN = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')
  ? 'lcyt-rtmp helpers still run synchronous better-sqlite3 SQL (SQLite only)'
  : false;
