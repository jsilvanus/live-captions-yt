/**
 * prisma/schema.prisma must describe exactly the tables the SQLite DDL creates (schema.js plus prisma/sqlite/schema.sql), and the PostgreSQL schema/migration must be derived from it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { initSqliteSchema } from '../src/db/schema.js';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Prisma } = require('../generated/sqlite');

// lcyt-production, lcyt-agent, lcyt-connectors and lcyt-platforms own no DDL any more: their tables come from schema.sql.
async function buildFullSqlite(file) {
  // Every table (core and plugin-owned) comes from initSqliteSchema; plugins create none.
  return initSqliteSchema(file);
}

test('schema.prisma matches the SQLite tables (names, columns, nullability, primary keys)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lcyt-drift-'));
  const db = await buildFullSqlite(join(dir, 'drift.db'));
  try {
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).map((r) => r.name).sort();
    const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.dbName ?? m.name, m]));
    assert.deepEqual([...models.keys()].sort(), tables, 'tables vs models');

    for (const table of tables) {
      const cols = await db.prepare(`PRAGMA table_info(${table})`).all();
      const fields = models.get(table).fields.filter((f) => f.kind !== 'object');
      assert.deepEqual(fields.map((f) => f.dbName ?? f.name).sort(), cols.map((c) => c.name).sort(), `${table}: columns`);
      for (const c of cols) {
        const f = fields.find((x) => (x.dbName ?? x.name) === c.name);
        const isPk = c.pk > 0;
        // SQLite lets non-INTEGER primary keys be NULL; Prisma needs them required.
        assert.equal(!f.isRequired, !(c.notnull || isPk), `${table}.${c.name}: nullability`);
      }
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PostgreSQL schema and migrations are derived from schema.prisma', () => {
  execFileSync('node', ['scripts/prisma-pg.mjs', '--check'], { cwd: root });
  const sql = execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel',
    'prisma/schema.postgresql.prisma', '--script'], { cwd: root, encoding: 'utf8' });
  // 0001_init.sql is the full schema as of the first release; later migrations add tables by hand.
  // Together their DDL (CREATE statements, order ignored) must equal the schema's.
  const ddl = (text) => text.split(/;\s*\n/).map((st) => st.replace(/--[^\n]*\n/g, '').replace(/\s+/g, ' ').trim())
    .filter((st) => /^CREATE /.test(st)).sort();
  const dir = join(root, 'prisma/postgres/migrations');
  const migrated = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .flatMap((f) => ddl(readFileSync(join(dir, f), 'utf8'))).sort();
  assert.deepEqual(migrated, ddl(sql),
    'prisma/postgres/migrations/*.sql no longer add up to schema.postgresql.prisma: add a migration (prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel prisma/schema.postgresql.prisma --script)');
});

test('prisma/sqlite/schema.sql matches schema.prisma', async () => {
  const { buildSqliteSql } = await import('../scripts/prisma-sqlite.mjs');
  assert.equal(readFileSync(join(root, 'prisma/sqlite/schema.sql'), 'utf8'), buildSqliteSql(),
    'prisma/sqlite/schema.sql is stale: npm run db:sqlite:build');
});
