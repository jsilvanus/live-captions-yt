#!/usr/bin/env node
/**
 * Derive the PostgreSQL Prisma schema (and its initial migration) from prisma/schema.prisma.
 *
 *   node scripts/prisma-pg.mjs           write prisma/schema.postgresql.prisma
 *   node scripts/prisma-pg.mjs --check   fail when the committed derived files are stale
 *   node scripts/prisma-pg.mjs --migration <name>
 *                                         also write prisma/postgres/migrations/<name>.sql
 *                                         (diff from the previous migrations' schema is NOT computed;
 *                                         use it for 0001 only, later migrations are written by hand)
 *
 * schema.prisma (SQLite) is the one source of truth. The only differences in the PostgreSQL copy:
 * provider, client output and the two SQLite default expressions for timestamps.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'prisma', 'schema.prisma');
const out = join(root, 'prisma', 'schema.postgresql.prisma');

export function derivePostgresSchema(sqliteSchema) {
  return sqliteSchema
    .replace(/^\/\/ GENERATED ONCE[\s\S]*?\n\n/, '// DERIVED from schema.prisma by scripts/prisma-pg.mjs. Do not edit.\n\n')
    .replace('output   = "../generated/sqlite"', 'output   = "../generated/postgres"')
    .replace('provider = "sqlite"', 'provider = "postgresql"')
    .replace(/dbgenerated\("datetime\('now'\)"\)/g,
      `dbgenerated("to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS')")`)
    .replace(/dbgenerated\("strftime\('%s','now'\)"\)/g, `dbgenerated("(EXTRACT(epoch FROM now()))::integer")`)
    .replace(/dbgenerated\("strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)"\)/g,
      `dbgenerated("to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD\\"T\\"HH24:MI:SS.MS\\"Z\\"')")`);
}

const derived = derivePostgresSchema(readFileSync(src, 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== derived) {
    console.error('prisma/schema.postgresql.prisma is stale: run `npm run db:pg:build -w lcyt-backend`');
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(out, derived);
console.log('wrote prisma/schema.postgresql.prisma');

const i = args.indexOf('--migration');
if (i !== -1) {
  const name = args[i + 1];
  const sql = execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-empty',
    '--to-schema-datamodel', out, '--script'], { cwd: root, encoding: 'utf8' });
  writeFileSync(join(root, 'prisma', 'postgres', 'migrations', `${name}.sql`), sql);
  console.log(`wrote prisma/postgres/migrations/${name}.sql`);
}
