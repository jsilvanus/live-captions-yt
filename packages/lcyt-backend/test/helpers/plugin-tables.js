/**
 * Plugin tables (prod_*, ai_config, ...) come from the backend Prisma schema on both SQLite and PostgreSQL,
 * so there is nothing to create here any more. Kept so existing tests keep working.
 */
export function ensurePluginTables(_db) {}
