/**
 * scripts/migrate-sqlite.mjs
 *
 * Unit tests cover the pure helpers and always run. The integration test runs only when DATABASE_URL is a
 * postgresql:// URL: it seeds a real SQLite file, migrates it into a throw-away PostgreSQL schema, and checks
 * counts, idempotence, value conversion and the sequence reset.
 */
process.env.LCYT_DB_SQL_COMPAT ??= '1';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, openPostgresUrl, isPostgresUrl } from '../src/db/connection.js';
import {
  parseArgs,
  validateOptions,
  maskUrl,
  secretsOf,
  scrubSecrets,
  orderTables,
  planCopy,
  batchSize,
  buildInsertSql,
  quoteIdent,
  convertValue,
  formatTable,
  migrateSqliteToPostgres,
  main,
  MigrationError,
} from '../scripts/migrate-sqlite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_JSON = join(HERE, '..', 'package.json');

describe('parseArgs', () => {
  test('defaults', () => {
    assert.deepEqual(parseArgs([]), { from: null, to: null, dryRun: false, batch: 500, help: false });
  });

  test('reads every option', () => {
    const o = parseArgs(['--from', './a.db', '--to', 'postgresql://u@h/d', '--dry-run', '--batch', '50']);
    assert.equal(o.from, './a.db');
    assert.equal(o.to, 'postgresql://u@h/d');
    assert.equal(o.dryRun, true);
    assert.equal(o.batch, 50);
  });

  test('rejects a bad batch size', () => {
    for (const bad of ['0', 'abc', '-3', '1.5', '20000']) {
      assert.throws(() => parseArgs(['--batch', bad]), MigrationError, bad);
    }
  });

  test('rejects a missing value and unknown flags', () => {
    assert.throws(() => parseArgs(['--from']), /needs a value/);
    assert.throws(() => parseArgs(['--from', '--to', 'x']), /needs a value/);
    assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  });
});

describe('validateOptions', () => {
  const ok = { from: 'a.db', to: 'postgresql://u@h/d' };

  test('requires both options', () => {
    assert.throws(() => validateOptions({ ...ok, from: null }, { isFile: () => true }), /--from/);
    assert.throws(() => validateOptions({ ...ok, to: null }, { isFile: () => true }), /--to/);
  });

  test('refuses a non-PostgreSQL target without echoing it', () => {
    const to = 'mysql://admin:hunter2@db.example/x';
    assert.throws(() => validateOptions({ ...ok, to }, { isFile: () => true }), (err) => {
      assert.match(err.message, /postgresql:\/\/ URL/);
      assert.doesNotMatch(err.message, /hunter2/);
      return true;
    });
  });

  test('refuses a missing source file', () => {
    assert.throws(() => validateOptions(ok, { isFile: () => false }), /not found/);
  });

  test('accepts an existing file', () => {
    assert.doesNotThrow(() => validateOptions({ from: PKG_JSON, to: 'postgresql://u@h/d' }));
  });
});

describe('URL masking and secret scrubbing', () => {
  test('masks the password and keeps the rest', () => {
    assert.equal(maskUrl('postgresql://app:s3cret@db.local:5432/lcyt?sslmode=require'),
      'postgresql://app:***@db.local:5432/lcyt?sslmode=require');
  });

  test('leaves URLs without a password alone', () => {
    assert.equal(maskUrl('postgresql://app@db.local/lcyt'), 'postgresql://app@db.local/lcyt');
    assert.equal(maskUrl('./lcyt-backend.db'), './lcyt-backend.db');
  });

  test('masks a password that contains an unencoded @', () => {
    const masked = maskUrl('postgresql://app:p@ss@db.local/lcyt');
    assert.equal(masked, 'postgresql://app:***@db.local/lcyt');
    assert.equal(secretsOf('postgresql://app:p@ss@db.local/lcyt')[0], 'p@ss');
  });

  test('secretsOf returns raw and decoded forms', () => {
    const forms = secretsOf('postgresql://app:p%40ss@db.local/lcyt');
    assert.deepEqual(forms.sort(), ['p%40ss', 'p@ss']);
    assert.deepEqual(secretsOf('postgresql://app@db.local/lcyt'), []);
  });

  test('scrubSecrets removes the URL and the password from error text', () => {
    const url = 'postgresql://app:s3cret@db.local/lcyt';
    const text = `connect failed for ${url} (password s3cret rejected)`;
    const out = scrubSecrets(text, url);
    assert.doesNotMatch(out, /s3cret/);
    assert.match(out, /postgresql:\/\/app:\*\*\*@db\.local\/lcyt/);
  });
});

describe('orderTables', () => {
  test('parents come before children', () => {
    const { order, cyclic } = orderTables(
      ['child', 'parent', 'grandchild'],
      [{ child: 'child', parent: 'parent' }, { child: 'grandchild', parent: 'child' }],
    );
    assert.deepEqual(order, ['parent', 'child', 'grandchild']);
    assert.deepEqual(cyclic, []);
  });

  test('self-references and edges to unknown tables are ignored', () => {
    const { order } = orderTables(
      ['users', 'org_members'],
      [{ child: 'users', parent: 'users' }, { child: 'users', parent: 'gone' }, { child: 'org_members', parent: 'users' }],
    );
    assert.deepEqual(order, ['users', 'org_members']);
  });

  test('keeps the input order when there are no relations', () => {
    assert.deepEqual(orderTables(['b', 'a', 'c'], []).order, ['b', 'a', 'c']);
  });

  test('reports a cycle and still returns every table', () => {
    const { order, cyclic } = orderTables(
      ['a', 'b', 'free'],
      [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }],
    );
    assert.deepEqual(cyclic, ['a', 'b']);
    assert.deepEqual(order, ['free', 'a', 'b']);
  });
});

describe('planCopy', () => {
  test('copies common tables with the common columns and reports the rest', () => {
    const plan = planCopy({
      sourceTables: new Map([
        ['users', ['id', 'email', 'legacy_flag']],
        ['old_table', ['id']],
        ['caption_targets', ['id', 'api_key']],
      ]),
      targetTables: new Map([
        ['users', [{ name: 'id', dataType: 'integer' }, { name: 'email', dataType: 'text' }, { name: 'created_at', dataType: 'text' }]],
        ['caption_targets', [{ name: 'id', dataType: 'text' }, { name: 'api_key', dataType: 'text' }]],
        ['bus_events', [{ name: 'id', dataType: 'integer' }]],
        ['_lcyt_migrations', [{ name: 'name', dataType: 'text' }]],
      ]),
    });
    assert.deepEqual(plan.copy.map((c) => c.table), ['users', 'caption_targets']);
    assert.deepEqual(plan.copy[0].columns, [
      { name: 'id', dataType: 'integer' },
      { name: 'email', dataType: 'text' },
    ]);
    assert.deepEqual(plan.ignoredInTarget, ['old_table']);
    assert.deepEqual(plan.missingInSource, ['bus_events']);
    assert.deepEqual(plan.columnNotes, [
      { table: 'users', onlyInSource: ['legacy_flag'], onlyInTarget: ['created_at'] },
    ]);
  });
});

describe('SQL building', () => {
  test('quoteIdent escapes double quotes', () => {
    assert.equal(quoteIdent('plain'), '"plain"');
    assert.equal(quoteIdent('we"ird'), '"we""ird"');
  });

  test('buildInsertSql numbers placeholders across rows and is idempotent', () => {
    assert.equal(
      buildInsertSql('caption_targets', ['id', 'api_key'], 2),
      'INSERT INTO "caption_targets" ("id", "api_key") VALUES ($1, $2), ($3, $4) ON CONFLICT DO NOTHING',
    );
  });

  test('batchSize respects the bind-parameter limit', () => {
    assert.equal(batchSize(500, 10), 500);
    assert.equal(batchSize(10000, 10), 3200);
    assert.equal(batchSize(500, 100000), 1);
  });
});

describe('convertValue', () => {
  const where = { table: 'api_keys', column: 'active', rowId: 7 };

  test('null stays null', () => {
    assert.equal(convertValue(null, 'integer', where), null);
    assert.equal(convertValue(undefined, 'text', where), null);
  });

  test('text: strings pass, numbers become text', () => {
    assert.equal(convertValue('abc', 'text'), 'abc');
    assert.equal(convertValue(42, 'text'), '42');
    assert.equal(convertValue(0.5, 'character varying'), '0.5');
  });

  test('integer: whole numbers and integer strings, range checked', () => {
    assert.equal(convertValue(1, 'integer'), 1);
    assert.equal(convertValue('12', 'integer'), 12);
    assert.equal(convertValue(2147483647, 'integer'), 2147483647);
    assert.throws(() => convertValue(2147483648, 'integer', where), /out of range/);
    assert.throws(() => convertValue(40000, 'smallint', where), /out of range/);
  });

  test('integer: refuses non-integers with table, row and column named', () => {
    assert.throws(() => convertValue(1.5, 'integer', where), (err) => {
      assert.ok(err instanceof MigrationError);
      assert.match(err.message, /table "api_keys", row 7, column "active": not an integer/);
      return true;
    });
    assert.throws(() => convertValue('yes', 'integer', where), /not an integer/);
  });

  test('bigint: returns BigInt', () => {
    assert.equal(convertValue(1700000000000, 'bigint'), 1700000000000n);
    assert.equal(typeof convertValue(5, 'bigint'), 'bigint');
    assert.equal(convertValue(9007199254740993n, 'bigint'), 9007199254740993n);
  });

  test('double precision: numbers and numeric strings', () => {
    assert.equal(convertValue(0.75, 'double precision'), 0.75);
    assert.equal(convertValue('0.75', 'double precision'), 0.75);
    assert.throws(() => convertValue('fast', 'double precision', where), /not a number/);
  });

  test('boolean: 0/1 become true/false, anything else fails', () => {
    assert.equal(convertValue(0, 'boolean'), false);
    assert.equal(convertValue(1, 'boolean'), true);
    assert.equal(convertValue(true, 'boolean'), true);
    assert.throws(() => convertValue(2, 'boolean', where), /not a boolean/);
  });

  test('bytea: binary passes, text fails', () => {
    const buf = Buffer.from([1, 2, 3]);
    assert.equal(convertValue(buf, 'bytea'), buf);
    assert.throws(() => convertValue('text', 'bytea', where), /not binary data/);
  });

  test('other types pass through; binary into a text column fails', () => {
    assert.equal(convertValue('2026-10-11 10:00:00', 'timestamp without time zone'), '2026-10-11 10:00:00');
    assert.throws(() => convertValue(Buffer.from('x'), 'text', where), /not text/);
    assert.throws(() => convertValue(Buffer.from('x'), 'timestamp without time zone', where), /binary data/);
  });
});

describe('formatTable', () => {
  test('aligns columns and shows null as a dash', () => {
    const out = formatTable([
      { table: 'users', copied: 3 },
      { table: 'bus_events', copied: null },
    ]);
    assert.equal(out, [
      'table       copied',
      '----------  ------',
      'users       3',
      'bus_events  -',
    ].join('\n'));
  });

  test('handles an empty report', () => {
    assert.equal(formatTable([]), '(no tables)');
  });
});

describe('main (argument errors, no database)', () => {
  test('bad arguments exit 2 and print usage without the URL password', async () => {
    const errors = [];
    const code = await main(['--from', './nope.db', '--to', 'postgresql://app:s3cret@h/d'], {
      log: () => {},
      error: (m) => errors.push(String(m)),
    });
    assert.equal(code, 2);
    assert.ok(errors.some((m) => /not found/.test(m)));
    assert.ok(errors.every((m) => !/s3cret/.test(m)));
  });

  test('--help exits 0', async () => {
    const logs = [];
    assert.equal(await main(['--help'], { log: (m) => logs.push(m), error: () => {} }), 0);
    assert.match(logs.join('\n'), /--dry-run/);
  });
});

/* ------------------------------------------------------------------ integration (PostgreSQL) */

const PG_URL = process.env.DATABASE_URL;
const pgSkip = isPostgresUrl(PG_URL) ? false : 'DATABASE_URL is not a postgresql:// URL';

const withSchema = (url, schema) => `${url}${url.includes('?') ? '&' : '?'}schema=${schema}`;

async function countRows(client, table) {
  const [row] = await client.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${quoteIdent(table)}`);
  return row.n;
}

/** Seed a SQLite file through the normal initDb() path (DATABASE_URL must not select PostgreSQL). */
async function seedSqlite(file) {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  let db;
  try {
    db = await initDb(file);
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
  await db.prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)').run('owner@example.test', 'hash', 'Owner');
  await db.prepare('INSERT INTO api_keys ("key", owner, user_id) VALUES (?, ?, ?)').run('lcyt_test_key_1', 'Owner', 1);
  await db.prepare('INSERT INTO caption_targets (id, api_key, type, url, enabled) VALUES (?, ?, ?, ?, ?)')
    .run('t1', 'lcyt_test_key_1', 'generic', 'https://example.test/hook', 1);
  await db.prepare('INSERT INTO ai_config (api_key, fuzzy_threshold) VALUES (?, ?)').run('lcyt_test_key_1', 0.82);
  for (let i = 1; i <= 3; i += 1) {
    await db.prepare('INSERT INTO bus_events (id, project_id, topic, ts, payload_json) VALUES (?, ?, ?, ?, ?)')
      .run(i, 'lcyt_test_key_1', 'caption.sent', 1700000000000 + i, '{}');
  }
  await db.close();
}

describe('migrateSqliteToPostgres (integration)', { skip: pgSkip }, () => {
  test('copies, is idempotent on re-run, and resets sequences', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lcyt-migrate-'));
    const file = join(dir, 'source.db');
    let schemaDb = null;
    let target = null;
    const quiet = () => {};
    try {
      await seedSqlite(file);
      schemaDb = await openPostgresUrl(PG_URL, { migrate: false, throwawaySchema: true });
      const to = withSchema(PG_URL, schemaDb.$testSchema.name);

      const first = await migrateSqliteToPostgres({ from: file, to, batch: 2, log: quiet });
      assert.equal(first.ok, true);
      target = await openPostgresUrl(to, { migrate: false });
      const counts = Object.fromEntries(first.rows.map((r) => [r.table, r]));
      assert.equal(counts.users.copied, 1);
      assert.equal(counts.bus_events.copied, 3);
      for (const row of first.rows) {
        assert.equal(await countRows(target, row.table), row.source, `${row.table} count`);
      }
      const [ai] = await target.$queryRawUnsafe('SELECT fuzzy_threshold FROM ai_config');
      assert.equal(ai.fuzzy_threshold, 0.82);

      const second = await migrateSqliteToPostgres({ from: file, to, batch: 2, log: quiet });
      assert.equal(second.ok, true);
      for (const row of second.rows) {
        assert.equal(row.copied, 0, `${row.table} re-copied rows`);
        assert.equal(row.alreadyPresent, row.source, `${row.table} already present`);
        assert.equal(row.targetAfter, row.source, `${row.table} total`);
      }

      const [inserted] = await target.$queryRawUnsafe(
        "INSERT INTO bus_events (topic, ts) VALUES ('test.after_migration', 1700000000009) RETURNING id",
      );
      assert.ok(Number(inserted.id) > 3, `new id ${inserted.id} should follow the migrated max (3)`);
    } finally {
      if (target) await target.close();
      if (schemaDb) await schemaDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('dry run writes nothing and leaves no schema behind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lcyt-migrate-'));
    const file = join(dir, 'source.db');
    let schemaDb = null;
    let check = null;
    try {
      await seedSqlite(file);
      schemaDb = await openPostgresUrl(PG_URL, { migrate: false, throwawaySchema: true });
      const to = withSchema(PG_URL, schemaDb.$testSchema.name);

      const report = await migrateSqliteToPostgres({ from: file, to, dryRun: true, log: () => {} });
      assert.equal(report.ok, true);
      assert.equal(report.dryRun, true);
      assert.ok(report.rows.some((r) => r.table === 'bus_events' && r.source === 3));

      check = await openPostgresUrl(to, { migrate: false });
      const [{ exists }] = await check.$queryRawUnsafe("SELECT to_regclass('_lcyt_migrations') IS NOT NULL AS exists");
      assert.equal(exists, false, 'dry run must not create the migration table in the target schema');
    } finally {
      if (check) await check.close();
      if (schemaDb) await schemaDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
