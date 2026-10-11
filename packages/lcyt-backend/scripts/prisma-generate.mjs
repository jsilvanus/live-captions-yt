#!/usr/bin/env node
/**
 * Generate the two Prisma clients (SQLite and PostgreSQL) into generated/.
 *   node scripts/prisma-generate.mjs          generate (fails loudly)
 *   node scripts/prisma-generate.mjs --soft   postinstall: skip quietly when the schema is not there
 *                                             yet (Docker copies package.json files before the sources)
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const soft = process.argv.includes('--soft');

if (!existsSync(join(root, 'prisma', 'schema.prisma'))) {
  if (soft) process.exit(0);
  console.error('prisma/schema.prisma not found');
  process.exit(1);
}

const require = createRequire(import.meta.url);
let prismaCli;
try {
  prismaCli = require.resolve('prisma/build/index.js');
} catch {
  if (soft) process.exit(0);
  throw new Error('prisma is not installed: run npm install');
}

const run = (args) => execFileSync(process.execPath, [prismaCli, ...args], { cwd: root, stdio: 'inherit' });

execFileSync(process.execPath, [join(root, 'scripts', 'prisma-pg.mjs')], { cwd: root, stdio: 'inherit' });
run(['generate', '--schema', 'prisma/schema.prisma']);
run(['generate', '--schema', 'prisma/schema.postgresql.prisma']);
