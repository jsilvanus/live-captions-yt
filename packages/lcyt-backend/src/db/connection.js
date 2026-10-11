/**
 * Database connection: one Prisma client for the whole backend.
 *
 *   DATABASE_URL=postgresql://...   PostgreSQL (tables created from prisma/postgres/migrations/*.sql)
 *   otherwise                        SQLite file (DB_PATH, default ./lcyt-backend.db; tables created by schema.js)
 *
 * Every function in src/db/*.js takes this client (or a transaction client from
 * `db.$transaction(tx => ...)`) as its first argument and returns Promises.
 *
 * The client carries three extra properties:
 *   $dialect  'sqlite' | 'postgres'
 *   $legacy   better-sqlite3 handle in SQLite mode (null on PostgreSQL). Plugins that have not been
 *             moved to Prisma yet still run synchronous SQL on it, so they only work on SQLite.
 */
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import '../express-async.js';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { initSqliteSchema } from './schema.js';
import { sqlNow, num } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..', '..');
const DEFAULT_DB_PATH = join(PKG_ROOT, 'lcyt-backend.db');

/** @typedef {import('../../generated/sqlite').PrismaClient} Db  Prisma client or transaction client */

let _dialect = 'sqlite';

/** 'sqlite' or 'postgres' for the database initDb() opened last. */
export function getDialect() {
  return _dialect;
}

export function isPostgresUrl(url) {
  return typeof url === 'string' && /^postgres(ql)?:\/\//.test(url);
}

async function loadClient(kind) {
  const mod = await import(new URL(`../../generated/${kind}/index.js`, import.meta.url).href).catch((err) => {
    throw new Error(`Prisma client for ${kind} is missing — run "npm run db:generate -w lcyt-backend" (${err.message})`);
  });
  return mod.PrismaClient ?? mod.default.PrismaClient;
}

/**
 * Apply prisma/postgres/migrations/*.sql in name order, once each, under an advisory lock so
 * several instances starting together do not race.
 */
export async function applyPostgresMigrations(prisma, dir = join(PKG_ROOT, 'prisma', 'postgres', 'migrations')) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  await prisma.$executeRawUnsafe('SELECT pg_advisory_lock(727401)');
  try {
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS _lcyt_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await prisma.$queryRawUnsafe('SELECT name FROM _lcyt_migrations')).map((r) => r.name));
    for (const file of files) {
      const name = file.replace(/\.sql$/, '');
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      const statements = sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !/^(--[^\n]*\n?)*$/.test(s));
      await prisma.$transaction(async (tx) => {
        for (const st of statements) await tx.$executeRawUnsafe(st);
        await tx.$executeRawUnsafe('INSERT INTO _lcyt_migrations (name) VALUES ($1)', name);
      });
    }
  } finally {
    await prisma.$executeRawUnsafe('SELECT pg_advisory_unlock(727401)');
  }
}

async function maybeSqlCompat(prisma, dialect) {
  if (process.env.LCYT_DB_SQL_COMPAT === '1') {
    (await import('./test-sql.js')).installSqlCompat(prisma, dialect);
  }
  return prisma;
}

/**
 * Open a PostgreSQL database by URL and return the Prisma client initDb() would build for it.
 * Pending migrations are applied under the advisory lock unless `migrate` is false.
 * `throwawaySchema` runs in a new schema of that database which close() drops (tests, dry runs).
 * @param {string} url postgresql:// URL (a `schema` query parameter selects the schema)
 */
export async function openPostgresUrl(url, { migrate = true, throwawaySchema = false } = {}) {
  if (!isPostgresUrl(url)) throw new Error('openPostgresUrl: expected a postgresql:// URL');
  const PrismaClient = await loadClient('postgres');
  let testSchema = null;
  let dbUrl = url;
  if (throwawaySchema) {
    testSchema = `t_${randomBytes(6).toString('hex')}`;
    const boot = new PrismaClient({ datasources: { db: { url } } });
    await boot.$executeRawUnsafe(`CREATE SCHEMA "${testSchema}"`);
    await boot.$disconnect();
    dbUrl = `${url}${url.includes('?') ? '&' : '?'}schema=${testSchema}`;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  prisma.$testSchema = testSchema ? { name: testSchema, url } : null;
  if (migrate) await applyPostgresMigrations(prisma);
  prisma.$dialect = 'postgres';
  prisma.$legacy = null;
  prisma.$util = { sqlNow, num };
  prisma.close = () => closeDb(prisma);
  return prisma;
}

/**
 * Open the database and return the Prisma client.
 * @param {string} [dbPath] SQLite file (ignored on PostgreSQL)
 * @returns {Promise<import('../../generated/sqlite').PrismaClient & { $dialect: string, $legacy: any }>}
 */
export async function initDb(dbPath) {
  if (dbPath === undefined && process.env.DB_PATH === ':memory:') dbPath = ':memory:';
  const url = process.env.DATABASE_URL;

  if (isPostgresUrl(url)) {
    _dialect = 'postgres';
    // ':memory:' (tests) = a throw-away schema in the configured database, dropped on close.
    const prisma = await openPostgresUrl(url, { throwawaySchema: dbPath === ':memory:' });
    return maybeSqlCompat(prisma, 'postgres');
  }

  _dialect = 'sqlite';
  // ':memory:' (tests) becomes a throw-away file: Prisma and the legacy handle must see the same database.
  const tmpDir = dbPath === ':memory:' ? mkdtempSync(join(tmpdir(), 'lcyt-db-')) : null;
  const file = tmpDir ? join(tmpDir, 'memory.db') : resolve(dbPath || process.env.DB_PATH || DEFAULT_DB_PATH);
  const legacy = initSqliteSchema(file);
  legacy.pragma('journal_mode = WAL');
  legacy.pragma('busy_timeout = 5000');
  const PrismaClient = await loadClient('sqlite');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${file}?connection_limit=1` } } });
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  prisma.$dialect = 'sqlite';
  prisma.$legacy = legacy;
  prisma.$util = { sqlNow, num };
  prisma.$tmpDir = tmpDir;
  prisma.close = () => closeDb(prisma);
  return maybeSqlCompat(prisma, 'sqlite');
}

/** Disconnect Prisma and close the legacy handle. */
export async function closeDb(db) {
  await db.$disconnect();
  if (db.$testSchema) {
    const PrismaClient = await loadClient('postgres');
    const boot = new PrismaClient({ datasources: { db: { url: db.$testSchema.url } } });
    await boot.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${db.$testSchema.name}" CASCADE`);
    await boot.$disconnect();
  }
  if (db.$legacy?.open) db.$legacy.close();
  if (db.$tmpDir) rmSync(db.$tmpDir, { recursive: true, force: true });
}
