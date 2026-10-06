/**
 * Compatibility wrapper for gradual Prisma migration
 * 
 * This module re-exports from db-factory.js and provides
 * a migration path that requires ZERO changes to existing
 * route code.
 * 
 * Usage:
 *   import { initDb } from './db.js';  // Existing code unchanged
 *   
 *   const db = initDb();  // Returns DbClient or better-sqlite3
 *   // Use normally: db.get(), db.run(), db.all()
 */

import Database from 'better-sqlite3';
import { DbClient, initDbFactory } from './db-factory.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import logger from 'lcyt/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'lcyt-backend.db');

/**
 * Legacy init function — still works, returns DbClient wrapper
 * (Previously imported from src/db/schema.js, now routes through db-factory)
 * 
 * @param {string} [dbPath]
 * @returns {DbClient | import('better-sqlite3').Database}
 */
export async function initDb(dbPath) {
  const dbType = process.env.DATABASE_URL?.startsWith('postgresql://') ? 'postgres' : 'sqlite';

  if (dbType === 'postgres') {
    logger.info('[db] Initializing PostgreSQL database via Prisma');
    const { prisma } = await initDbFactory();
    // Return a DbClient instance that wraps Prisma
    return new DbClient(prisma, null, 'postgres');
  } else {
    // For SQLite: still use better-sqlite3 for backward compatibility
    // (The schema.js module handles actual initialization)
    logger.info('[db] Initializing SQLite database');
    const { initDb: initSqlite } = await import('./schema.js');
    const sqlite = initSqlite(dbPath || process.env.DB_PATH || DEFAULT_DB_PATH);
    // Wrap it in DbClient for unified interface
    return new DbClient(null, sqlite, 'sqlite');
  }
}

/**
 * Initialize database using factory approach
 * Automatically chooses SQLite or PostgreSQL based on DATABASE_URL
 * 
 * @returns {Promise<DbClient>}
 */
export async function initDbAuto() {
  return initDb();
}

// Re-export all db modules for use with the new abstraction
// These are already updated to work with DbClient
export * from './schema.js';
export * from './db-factory.js';

/**
 * Helper: wrap a raw better-sqlite3 Database in DbClient
 * Useful if you have an existing db instance and need DbClient interface
 * 
 * @param {import('better-sqlite3').Database} sqlite
 * @returns {DbClient}
 */
export function wrapSqliteDb(sqlite) {
  return new DbClient(null, sqlite, 'sqlite');
}
