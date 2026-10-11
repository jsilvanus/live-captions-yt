/**
 * Plugin-owned tables (prod_*, ai_config) on SQLite exist only after the plugin DDL ran, on the legacy
 * better-sqlite3 handle. On PostgreSQL they all come from prisma/postgres/migrations/0001_init.sql, so
 * this is a no-op there.
 */
import { runMigrations as runProductionMigrations } from '../../../plugins/lcyt-production/src/db.js';
import { runAiMigrations } from '../../src/ai/config.js';

export function ensurePluginTables(db) {
  if (!db.$legacy) return;
  runProductionMigrations(db.$legacy);
  runAiMigrations(db.$legacy);
}
