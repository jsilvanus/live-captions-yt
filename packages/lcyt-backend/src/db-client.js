/**
 * Database Client abstraction layer
 * - SQLite: Wraps better-sqlite3 (synchronous)
 * - PostgreSQL: Wraps Prisma Client (async, Phase 2+)
 * 
 * During Phase 1 (SQLite only), this is just a thin wrapper.
 * API is designed to be compatible with SQLite prepare/get/run/all patterns.
 */

export class DbClient {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.type = 'sqlite';
  }

  /**
   * Execute raw SQL (for migrations/DDL)
   * @param {string} sql
   */
  exec(sql) {
    return this.sqlite.exec(sql);
  }

  /**
   * Execute a prepared statement (INSERT/UPDATE/DELETE)
   * @param {string} sql
   * @param {any[]} params - Array of parameters
   * @returns {{lastInsertRowid: number, changes: number}}
   */
  run(sql, params = []) {
    const result = this.sqlite.prepare(sql).run(...params);
    return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
  }

  /**
   * Query a single row
   * @param {string} sql
   * @param {any[]} params - Array of parameters
   * @returns {object|undefined}
   */
  get(sql, params = []) {
    return this.sqlite.prepare(sql).get(...params);
  }

  /**
   * Query all rows
   * @param {string} sql
   * @param {any[]} params - Array of parameters
   * @returns {object[]}
   */
  all(sql, params = []) {
    return this.sqlite.prepare(sql).all(...params);
  }

  /**
   * Execute a transaction
   * @param {Function} fn - Callback that receives db instance
   * @returns {Function} A transaction-wrapped function that can be called
   */
  transaction(fn) {
    const sqlite = this.sqlite;
    const txFn = sqlite.transaction(fn);
    return txFn;
  }

  /**
   * Prepare a statement for reuse (SQLite optimization)
   * @param {string} sql
   * @returns {object}
   */
  prepare(sql) {
    return this.sqlite.prepare(sql);
  }

  /**
   * Close database connection
   */
  close() {
    this.sqlite.close();
  }

  /**
   * Get underlying SQLite connection (for advanced usage)
   */
  getConnection() {
    return this.sqlite;
  }
}
