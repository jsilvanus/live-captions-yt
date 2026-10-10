import { Client, Pool } from 'pg';

/**
 * Database Client abstraction layer
 * - SQLite: Wraps better-sqlite3 (synchronous)
 * - PostgreSQL: Wraps pg library (async queries, but sync initialization)
 * 
 * API is designed to work with SQLite's synchronous patterns.
 * For Phase 2+ with PostgreSQL, callers need to await async query methods.
 */

export class DbClient {
  constructor(sqlite, pgPool, pgType) {
    this.sqlite = sqlite;
    this.pgPool = pgPool;
    this.type = pgType || 'sqlite';
  }

  static detectDatabaseType(databaseUrl) {
    if (!databaseUrl) return 'sqlite';
    if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
      return 'postgres';
    }
    return 'sqlite';
  }

  /**
   * Execute raw SQL (for migrations/DDL) - SYNC for SQLite, async for PostgreSQL
   * For SQLite: synchronous
   * For PostgreSQL: must be awaited
   * @param {string} sql
   */
  exec(sql) {
    if (this.type === 'sqlite') {
      return this.sqlite.exec(sql);
    } else {
      // For PostgreSQL: return a promise
      // Caller must await this when using PostgreSQL
      return this._execAsync(sql);
    }
  }

  async _execAsync(sql) {
    const client = await this.pgPool.connect();
    try {
      return await client.query(sql);
    } finally {
      client.release();
    }
  }

  /**
   * Execute a prepared statement (INSERT/UPDATE/DELETE)
   * For SQLite: synchronous, returns {lastInsertRowid, changes}
   * For PostgreSQL: async Promise, must be awaited
   * @param {string} sql
   * @param {any[]} params - Array of parameters
   */
  run(sql, params = []) {
    if (this.type === 'sqlite') {
      const result = this.sqlite.prepare(sql).run(...params);
      return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
    } else {
      // For PostgreSQL: return a promise
      return this._runAsync(sql, params);
    }
  }

  async _runAsync(sql, params) {
    const result = await this.pgPool.query(sql, params);
    return { lastInsertRowid: result.rows[0]?.id || null, changes: result.rowCount };
  }

  /**
   * Query a single row
   * For SQLite: synchronous
   * For PostgreSQL: async Promise, must be awaited
   * @param {string} sql
   * @param {any[]} params - Array of parameters
   */
  get(sql, params = []) {
    if (this.type === 'sqlite') {
      return this.sqlite.prepare(sql).get(...params);
    } else {
      return this._getAsync(sql, params);
    }
  }

  async _getAsync(sql, params) {
    const result = await this.pgPool.query(sql, params);
    return result.rows[0];
  }

  /**
   * Query all rows
   * For SQLite: synchronous
   * For PostgreSQL: async Promise, must be awaited
   * @param {string} sql
   * @param {any[]} params - Array of parameters
   */
  all(sql, params = []) {
    if (this.type === 'sqlite') {
      return this.sqlite.prepare(sql).all(...params);
    } else {
      return this._allAsync(sql, params);
    }
  }

  async _allAsync(sql, params) {
    const result = await this.pgPool.query(sql, params);
    return result.rows;
  }

  /**
   * Execute a transaction
   * @param {Function} fn - Callback that receives db instance
   * @returns {Function | Promise}
   */
  transaction(fn) {
    if (this.type === 'sqlite') {
      const sqlite = this.sqlite;
      const txFn = sqlite.transaction(fn);
      return txFn;
    } else {
      // For PostgreSQL, return an async function that manages the transaction
      return async (...args) => {
        const client = await this.pgPool.connect();
        try {
          await client.query('BEGIN');
          // Create a transaction-aware DbClient
          const txClient = new DbClient(null, { query: client.query.bind(client) }, 'postgres-tx');
          const result = await fn.apply(txClient, args);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };
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
      // For PostgreSQL, return a wrapper that matches the SQLite API
      return {
        run: (...params) => this.run(sql, params),
        get: (...params) => this.get(sql, params),
        all: (...params) => this.all(sql, params),
      };
    }
  }

  /**
   * Execute PRAGMA command (SQLite only)
   * @param {string} pragma
   * @param {object} [options]
   */
  pragma(pragma, options) {
    if (this.type === 'sqlite') {
      return this.sqlite.pragma(pragma, options);
    } else {
      throw new Error('PRAGMA not supported for PostgreSQL');
    }
  }

  /**
   * Backup database (SQLite only)
   * Synchronous for SQLite (better-sqlite3 is sync)
   * @param {string} path - Destination file path
   * @returns {Promise<void>} - Always returns a promise for consistency
   */
  backup(path) {
    if (this.type === 'sqlite') {
      // better-sqlite3.backup() is synchronous, but we return a Promise
      // for consistency with async PostgreSQL code paths
      return Promise.resolve(this.sqlite.backup(path));
    } else {
      return Promise.reject(new Error('Backup not supported for PostgreSQL'));
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.type === 'sqlite') {
      this.sqlite.close();
    } else {
      await this.pgPool.end();
    }
  }

  /**
   * Get underlying connection (for advanced usage)
   */
  getConnection() {
    return this.type === 'sqlite' ? this.sqlite : this.pgPool;
  }

  /**
   * Create a backup of the database
   * For SQLite: synchronous backup using better-sqlite3's backup() method
   * For PostgreSQL: not yet implemented
   * @param {string} path - Destination file path
   */
  backup(path) {
    if (this.type === 'sqlite') {
      return this.sqlite.backup(path);
    } else {
      throw new Error('Database backup is not yet implemented for PostgreSQL');
    }
  }

  /**
   * Execute a SQLite PRAGMA statement
   * For SQLite: delegates to better-sqlite3's pragma() method
   * For PostgreSQL: throws (Postgres does not have PRAGMAs)
   * @param {string} pragma - PRAGMA name
   * @param {Object} options - Options object (e.g., { simple: true })
   * @returns {*} Pragma result
   */
  pragma(pragma, options) {
    if (this.type === 'sqlite') {
      return this.sqlite.pragma(pragma, options);
    } else {
      throw new Error('PRAGMA statements are not supported for PostgreSQL');
    }
  }
}


