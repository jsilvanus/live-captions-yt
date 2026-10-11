/**
 * prisma/schema.prisma must describe exactly the tables the SQLite DDL creates (schema.js plus the
 * plugin init functions), and the PostgreSQL schema/migration must be derived from it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { initSqliteSchema } from '../src/db/schema.js';
import { runAiMigrations } from '../src/ai/config.js';
import { initProductionControl } from 'lcyt-production';
import { initFilesControl } from 'lcyt-files';
import { initRtmpControl } from 'lcyt-rtmp';
import { initDskControl } from 'lcyt-dsk';
import { initCueEngine } from 'lcyt-cues';
import { initAgent } from 'lcyt-agent';
import { initConnectors } from 'lcyt-connectors';
import { initActions } from 'lcyt-actions';
import { initPlatforms } from 'lcyt-platforms';
import { initMusicControl } from 'lcyt-music';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Prisma } = require('../generated/sqlite');

// The plugin init functions start background services (Chromium renderer, pollers, device registry);
// collect them so the test process can exit.
const services = [];

async function buildFullSqlite(file) {
  const db = initSqliteSchema(file);
  runAiMigrations(db);
  services.push(await initProductionControl(db, {}));
  await initFilesControl(db, {});
  await initRtmpControl(db, null, {});
  services.push(await initDskControl(db, { on() {}, emit() {} }, null, {}));
  await initCueEngine(db);
  await initAgent(db, {});
  initConnectors(db, {});
  initActions(db);
  services.push(initPlatforms(db, {}));
  await initMusicControl(db, null, {});
  return db;
}

async function stopServices() {
  for (const s of services.splice(0)) {
    for (const fn of [s?.stop, s?.registry?.stop, s?.poller?.stop]) {
      try { await fn?.call(fn === s?.registry?.stop ? s.registry : fn === s?.poller?.stop ? s.poller : s); } catch { /* best effort */ }
    }
  }
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

test('PostgreSQL schema and initial migration are derived from schema.prisma', () => {
  execFileSync('node', ['scripts/prisma-pg.mjs', '--check'], { cwd: root });
  const sql = execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel',
    'prisma/schema.postgresql.prisma', '--script'], { cwd: root, encoding: 'utf8' });
  assert.equal(readFileSync(join(root, 'prisma/postgres/migrations/0001_init.sql'), 'utf8'), sql,
    'prisma/postgres/migrations/0001_init.sql is stale: npm run db:pg:build -- --migration 0001_init');
});

after(stopServices);
