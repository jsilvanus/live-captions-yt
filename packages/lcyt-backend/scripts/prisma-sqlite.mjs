#!/usr/bin/env node
/**
 * Generate prisma/sqlite/schema.sql (idempotent CREATE TABLE/INDEX IF NOT EXISTS) from prisma/schema.prisma.
 * initSqliteSchema() applies it after the hand-written core DDL, so plugin tables exist on SQLite
 * without plugin-owned migrations.
 *   node scripts/prisma-sqlite.mjs          write the file
 *   node scripts/prisma-sqlite.mjs --check  fail when stale
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'prisma', 'sqlite', 'schema.sql');

export function buildSqliteSql() {
  const raw = execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return raw
    .replace(/CREATE TABLE "/g, 'CREATE TABLE IF NOT EXISTS "')
    .replace(/CREATE (UNIQUE )?INDEX "/g, 'CREATE $1INDEX IF NOT EXISTS "')
    .replace(/"sqlite_autoindex_/g, '"uq_')
    .replace(/DEFAULT (datetime\('now'\)|strftime\([^)]*\))/g, 'DEFAULT ($1)');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = buildSqliteSql();
  if (process.argv.includes('--check')) {
    if (!existsSync(out) || readFileSync(out, 'utf8') !== sql) { console.error('prisma/sqlite/schema.sql is stale: npm run db:sqlite:build'); process.exit(1); }
  } else writeFileSync(out, sql);
}
