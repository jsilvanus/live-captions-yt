/**
 * Database initialization factory
 * Supports both SQLite (better-sqlite3) and PostgreSQL (via Prisma)
 * 
 * Usage:
 *   const db = await initDbFactory();
 *   const users = db.query('SELECT * FROM users'); // Prisma-style or raw SQL
 */

import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import logger from 'lcyt/logger';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'lcyt-backend.db');

/**
 * Detect database type from DATABASE_URL
 * @returns {'sqlite' | 'postgres' | null}
 */
function detectDatabaseType() {
  const url = process.env.DATABASE_URL || '';
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgres';
  } else if (url.startsWith('file://') || url.includes('.db') || url === '') {
    return 'sqlite';
  }
  return null;
}

/**
 * Initialize Prisma client for either SQLite or PostgreSQL
 * @returns {Promise<PrismaClient>}
 */
export async function initPrismaClient() {
  const dbType = detectDatabaseType();
  logger.info(`[db] Initializing ${dbType || 'sqlite'} database`);

  const prisma = new PrismaClient({
    log: process.env.PRISMA_LOG
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
  });

  // Test connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('[db] Database connection successful');
  } catch (err) {
    logger.error('[db] Database connection failed:', err.message);
    throw err;
  }

  return prisma;
}

/**
 * Initialize SQLite database (legacy, for backward compatibility)
 * Runs schema initialization and migrations
 * @param {string} [dbPath]
 * @returns {import('better-sqlite3').Database}
 */
export async function initSqliteDb(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || DEFAULT_DB_PATH;
  logger.info(`[db] Initializing SQLite database at ${resolvedPath}`);

  // Lazy-load the schema initialization to keep this module lightweight
  const { initDb } = await import('./schema.js');
  const db = initDb(resolvedPath);

  logger.info('[db] SQLite database initialized');
  return db;
}

/**
 * Initialize database based on DATABASE_URL environment variable
 * Returns an abstraction that works with both SQLite and PostgreSQL
 * 
 * @returns {Promise<{prisma: PrismaClient | null, sqlite: Database | null, type: 'sqlite' | 'postgres'}>}
 */
export async function initDbFactory() {
  const dbType = detectDatabaseType();

  if (dbType === 'postgres') {
    // PostgreSQL: use Prisma
    const prisma = await initPrismaClient();
    return {
      prisma,
      sqlite: null,
      type: 'postgres',
      // Convenience method for raw queries (PostgreSQL)
      query: (sql, params) => prisma.$queryRawUnsafe(sql, ...params),
    };
  } else {
    // SQLite: use better-sqlite3
    const sqlite = await initSqliteDb();
    return {
      prisma: null,
      sqlite,
      type: 'sqlite',
      // Convenience method for raw queries (SQLite)
      query: (sql, params) => sqlite.prepare(sql).all(...params),
    };
  }
}

/**
 * Compatibility wrapper: transparently use Prisma or SQLite
 * This is a bridge layer during migration
 */
export class DbClient {
  constructor(prisma, sqlite, type) {
    this.prisma = prisma;
    this.sqlite = sqlite;
    this.type = type;
  }

  static async create() {
    const { prisma, sqlite, type } = await initDbFactory();
    return new DbClient(prisma, sqlite, type);
  }

  // Adapter methods for common patterns (see src/db/*.js for examples)
  // These allow gradual migration without changing route handlers

  /**
   * Execute a prepared statement (INSERT/UPDATE/DELETE)
   * @param {string} sql
   * @param  {...any} params
   * @returns {number} changes
   */
  run(sql, ...params) {
    if (this.type === 'sqlite') {
      const result = this.sqlite.prepare(sql).run(...params);
      return result.changes;
    } else {
      // PostgreSQL: use Prisma $executeRawUnsafe
      // Note: This returns affected rows count
      return this.prisma.$executeRawUnsafe(sql, ...params);
    }
  }

  /**
   * Query a single row (SELECT ... LIMIT 1)
   * @param {string} sql
   * @param  {...any} params
   * @returns {object|undefined}
   */
  get(sql, ...params) {
    if (this.type === 'sqlite') {
      return this.sqlite.prepare(sql).get(...params);
    } else {
      // PostgreSQL: use Prisma $queryRawUnsafe
      return this.prisma.$queryRawUnsafe(sql, ...params).then(rows => rows?.[0]);
    }
  }

  /**
   * Query all rows
   * @param {string} sql
   * @param  {...any} params
   * @returns {object[]}
   */
  all(sql, ...params) {
    if (this.type === 'sqlite') {
      return this.sqlite.prepare(sql).all(...params);
    } else {
      // PostgreSQL
      return this.prisma.$queryRawUnsafe(sql, ...params);
    }
  }

  /**
   * Execute a transaction
   * @param {Function} fn
   * @returns {any}
   */
  transaction(fn) {
    if (this.type === 'sqlite') {
      return this.sqlite.transaction(fn)();
    } else {
      // PostgreSQL: use Prisma transaction
      return this.prisma.$transaction(async (tx) => {
        // Wrap the SQLite-like API around Prisma transaction
        return fn(new DbClient(tx, null, 'postgres'));
      });
    }
  }

  /**
   * Prepare a statement for reuse (SQLite optimization)
   * @param {string} sql
   * @returns {object}
   */
  prepare(sql) {
    if (this.type === 'sqlite') {
      return this.sqlite.prepare(sql);
    } else {
      // PostgreSQL: return a proxy that uses Prisma
      return {
        run: (...params) => this.run(sql, ...params),
        get: (...params) => this.get(sql, ...params),
        all: (...params) => this.all(sql, ...params),
      };
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.type === 'sqlite') {
      this.sqlite.close();
    } else {
      await this.prisma.$disconnect();
    }
  }
}

export default DbClient;
