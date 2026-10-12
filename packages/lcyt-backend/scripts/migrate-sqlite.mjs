#!/usr/bin/env node
/**
 * Copy an existing SQLite lcyt-backend database (DB_PATH) into a PostgreSQL database (DATABASE_URL).
 *
 *   npm run db:migrate-sqlite -- --from ./lcyt-backend.db --to postgresql://user@host/db [--dry-run] [--batch 500]
 *
 * What it does:
 *   1. Opens the SQLite file read-only and the PostgreSQL database through openPostgresUrl() (the same
 *      client initDb() builds: pending migrations are applied under the advisory lock).
 *   2. Copies every table that exists on both sides, parents before children (foreign-key order), in
 *      batches with INSERT ... ON CONFLICT DO NOTHING. Re-running only fills what is missing.
 *   3. Converts values to the target column types (information_schema): 0/1 become true/false for
 *      boolean columns, bigint columns get BigInt. A value that does not fit fails the run with a
 *      message naming table, row and column; nothing is dropped silently.
 *   4. Resets the id sequences of copied tables to max(id), so new rows do not collide.
 *   5. Counts rows on both sides, prints a table and exits 1 if any target count is lower than the source.
 *
 * --dry-run reads and converts every source row and writes no data. It validates against the target
 * schema; when the target has no schema yet it validates against a throw-away schema that is dropped.
 *
 * Back up the SQLite file first. The copy is idempotent but not one transaction: a failed run leaves the
 * tables copied so far in place, and running it again completes the rest.
 *
 * The pure helpers are exported for unit tests (test/migrate-sqlite.test.js).
 */
import Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPostgresUrl, openPostgresUrl } from '../src/db/connection.js';

export const DEFAULT_BATCH = 500;
export const MAX_BATCH = 10000;
/** PostgreSQL accepts at most 65535 bind parameters per statement; stay well below. */
const MAX_PARAMS = 32000;
/** Tables the target creates for itself; never copied, never reported as missing. */
const INTERNAL_TABLES = new Set(['_lcyt_migrations']);
const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint']);

export const USAGE = `usage: npm run db:migrate-sqlite -- --from <sqlite file> --to <postgresql:// URL> [--dry-run] [--batch N]

  --from      SQLite database file (read-only; back it up first)
  --to        PostgreSQL URL, e.g. postgresql://user@host/db (the password is never printed)
  --dry-run   read and validate every row, write nothing
  --batch     rows per INSERT (1-${MAX_BATCH}, default ${DEFAULT_BATCH})`;

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationError';
  }
}

/* ------------------------------------------------------------------ arguments and URLs */

/**
 * @param {string[]} argv arguments after the script name
 * @returns {{ from: string|null, to: string|null, dryRun: boolean, batch: number, help: boolean }}
 */
export function parseArgs(argv) {
  const opts = { from: null, to: null, dryRun: false, batch: DEFAULT_BATCH, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new MigrationError(`${arg} needs a value`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--from': opts.from = value(); break;
      case '--to': opts.to = value(); break;
      case '--batch': {
        const raw = value();
        const n = Number(raw);
        if (!/^\d+$/.test(raw) || n < 1 || n > MAX_BATCH) {
          throw new MigrationError(`--batch must be a whole number from 1 to ${MAX_BATCH}`);
        }
        opts.batch = n;
        break;
      }
      case '--dry-run': opts.dryRun = true; break;
      case '-h':
      case '--help': opts.help = true; break;
      default: throw new MigrationError(`unknown argument ${arg}`);
    }
  }
  return opts;
}

const defaultIsFile = (p) => existsSync(p) && statSync(p).isFile();

/**
 * Refuse bad input before anything is opened. Messages never echo the --to value (it may hold a password).
 * @param {{ from: string|null, to: string|null }} opts
 */
export function validateOptions(opts, { isFile = defaultIsFile } = {}) {
  if (!opts.from) throw new MigrationError('--from <sqlite file> is required');
  if (!opts.to) throw new MigrationError('--to <postgresql:// URL> is required');
  if (!isPostgresUrl(opts.to)) throw new MigrationError('--to must be a postgresql:// URL');
  if (!isFile(opts.from)) throw new MigrationError(`--from file not found: ${opts.from}`);
}

/** The URL with its password replaced by ***. Safe to print. */
export function maskUrl(url) {
  const m = /^([a-zA-Z][\w+.-]*:\/\/)(.*)@([^@]*)$/.exec(String(url));
  if (!m) return String(url);
  const [, scheme, userinfo, rest] = m;
  const colon = userinfo.indexOf(':');
  if (colon === -1) return `${scheme}${userinfo}@${rest}`;
  return `${scheme}${userinfo.slice(0, colon)}:***@${rest}`;
}

/** Password forms (raw and percent-decoded) that must never appear in a message. */
export function secretsOf(url) {
  const m = /^[a-zA-Z][\w+.-]*:\/\/(.*)@([^@]*)$/.exec(String(url));
  if (!m || !m[1].includes(':')) return [];
  const password = m[1].slice(m[1].indexOf(':') + 1);
  const forms = new Set([password]);
  try {
    forms.add(decodeURIComponent(password));
  } catch {
    // not percent-encoded
  }
  return [...forms].filter(Boolean);
}

/** Remove the --to URL (masked) and its password from free text such as driver error messages. */
export function scrubSecrets(text, url) {
  let out = String(text);
  if (url) out = out.split(url).join(maskUrl(url));
  for (const secret of secretsOf(url)) out = out.split(secret).join('***');
  return out;
}

/* ------------------------------------------------------------------ planning (pure) */

export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Order tables so that every parent comes before its children. Self-references are ignored; edges to
 * tables outside `tables` are ignored. A cycle (should not happen with this schema) keeps the cycle's
 * tables at the end in input order and reports them.
 * @param {string[]} tables
 * @param {{ child: string, parent: string }[]} edges
 * @returns {{ order: string[], cyclic: string[] }}
 */
export function orderTables(tables, edges) {
  const known = new Set(tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of edges) {
    if (child === parent || !known.has(child) || !known.has(parent)) continue;
    deps.get(child).add(parent);
  }
  const order = [];
  const placed = new Set();
  let progress = true;
  while (order.length < tables.length && progress) {
    progress = false;
    for (const t of tables) {
      if (placed.has(t)) continue;
      if ([...deps.get(t)].every((p) => placed.has(p))) {
        order.push(t);
        placed.add(t);
        progress = true;
      }
    }
  }
  const cyclic = tables.filter((t) => !placed.has(t));
  return { order: [...order, ...cyclic], cyclic };
}

/**
 * Decide what to copy. Source tables are copied when the target has them too; the columns copied are the
 * ones both sides have (target types are kept for conversion).
 * @param {{ sourceTables: Map<string, string[]>, targetTables: Map<string, {name: string, dataType: string}[]> }} input
 */
export function planCopy({ sourceTables, targetTables }) {
  const copy = [];
  const ignoredInTarget = [];
  const columnNotes = [];
  for (const [table, srcCols] of sourceTables) {
    const tgt = targetTables.get(table);
    if (!tgt) {
      ignoredInTarget.push(table);
      continue;
    }
    const tgtByName = new Map(tgt.map((c) => [c.name, c]));
    const columns = srcCols
      .filter((name) => tgtByName.has(name))
      .map((name) => ({ name, dataType: tgtByName.get(name).dataType }));
    const onlyInSource = srcCols.filter((n) => !tgtByName.has(n));
    const onlyInTarget = tgt.map((c) => c.name).filter((n) => !srcCols.includes(n));
    if (onlyInSource.length || onlyInTarget.length) columnNotes.push({ table, onlyInSource, onlyInTarget });
    if (columns.length === 0) ignoredInTarget.push(table);
    else copy.push({ table, columns });
  }
  const missingInSource = [...targetTables.keys()].filter((t) => !sourceTables.has(t) && !INTERNAL_TABLES.has(t));
  return { copy, missingInSource, ignoredInTarget, columnNotes };
}

/** Rows per INSERT so that rows x columns stays under the bind-parameter limit. */
export function batchSize(requested, columnCount) {
  return Math.max(1, Math.min(requested, Math.floor(MAX_PARAMS / Math.max(1, columnCount))));
}

/** INSERT with one $n placeholder per value; ON CONFLICT DO NOTHING makes a re-run a no-op. */
export function buildInsertSql(table, columns, rowCount) {
  let n = 0;
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    rows.push(`(${columns.map(() => `$${++n}`).join(', ')})`);
  }
  const names = columns.map(quoteIdent).join(', ');
  return `INSERT INTO ${quoteIdent(table)} (${names}) VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING`;
}

/* ------------------------------------------------------------------ values (pure) */

const TEXT_TYPES = new Set(['text', 'character varying', 'character', 'name']);
const FLOAT_TYPES = new Set(['double precision', 'real', 'numeric']);
const INT_RE = /^[+-]?\d+$/;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const isBinary = (v) => v instanceof Uint8Array;

function preview(value) {
  if (isBinary(value)) return `<${value.length} bytes>`;
  const s = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/**
 * Convert one SQLite value for a PostgreSQL column of `dataType` (information_schema.data_type).
 * @param {unknown} value
 * @param {string} dataType
 * @param {{ table?: string, column?: string, rowId?: number }} [where] only used in error messages
 * @returns {unknown} a value the PostgreSQL driver can bind
 * @throws {MigrationError} when the value cannot be stored in that column type
 */
export function convertValue(value, dataType, where = {}) {
  if (value === null || value === undefined) return null;
  const type = String(dataType).toLowerCase();
  const fail = (reason) => {
    throw new MigrationError(
      `table "${where.table}", row ${where.rowId ?? '?'}, column "${where.column}": ${reason} `
      + `(value ${preview(value)} for ${type})`,
    );
  };

  if (TEXT_TYPES.has(type)) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    return fail('not text');
  }
  if (type === 'integer' || type === 'smallint' || type === 'bigint') {
    let big;
    if (typeof value === 'bigint') big = value;
    else if (typeof value === 'number' && Number.isInteger(value)) big = BigInt(value);
    else if (typeof value === 'string' && INT_RE.test(value.trim())) big = BigInt(value.trim());
    else return fail('not an integer');
    const bits = type === 'smallint' ? 16n : type === 'integer' ? 32n : 64n;
    const limit = 1n << (bits - 1n);
    if (big < -limit || big >= limit) return fail('out of range');
    return type === 'bigint' ? big : Number(big);
  }
  if (FLOAT_TYPES.has(type)) {
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && NUM_RE.test(value.trim())) return Number(value.trim());
    return fail('not a number');
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 0 || value === 1) return value === 1;
    if (value === 'true' || value === 'false') return value === 'true';
    return fail('not a boolean (expected 0 or 1)');
  }
  if (type === 'bytea') {
    if (isBinary(value)) return value;
    return fail('not binary data');
  }
  if (isBinary(value)) return fail('binary data for a non-binary column');
  // Timestamps, JSON and other types: PostgreSQL parses the text and reports a bad value with the table.
  return value;
}

/** Plain-text table for the summary (pure). */
export function formatTable(rows) {
  if (rows.length === 0) return '(no tables)';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v === null || v === undefined ? '-' : String(v));
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals) => vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [
    line(cols),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map((r) => line(cols.map((c) => cell(r[c])))),
  ].join('\n');
}

/* ------------------------------------------------------------------ database access */

function readSourceCatalog(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const columns = new Map();
  const edges = [];
  for (const table of tables) {
    columns.set(table, db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((r) => r.name));
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all()) {
      edges.push({ child: table, parent: fk.table });
    }
  }
  return { tables, columns, edges };
}

async function readTargetCatalog(target) {
  const cols = await target.$queryRawUnsafe(
    'SELECT table_name, column_name, data_type FROM information_schema.columns '
    + 'WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position',
  );
  const tables = new Map();
  for (const r of cols) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, []);
    tables.get(r.table_name).push({ name: r.column_name, dataType: r.data_type });
  }
  const fks = await target.$queryRawUnsafe(
    'SELECT c.relname AS child, p.relname AS parent FROM pg_constraint k '
    + 'JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid '
    + 'JOIN pg_namespace n ON n.oid = c.relnamespace '
    + "WHERE k.contype = 'f' AND n.nspname = current_schema()",
  );
  return { tables, edges: fks.map((r) => ({ child: r.child, parent: r.parent })) };
}

async function countRows(client, table) {
  const [row] = await client.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM ${quoteIdent(table)}`);
  return Number(row.n);
}

async function insertBatch(target, table, columns, rows, clean) {
  const names = columns.map((c) => c.name);
  try {
    return await target.$executeRawUnsafe(buildInsertSql(table, names, rows.length), ...rows.flatMap((r) => r.values));
  } catch {
    // One statement failed as a whole. Retry row by row so the error names the row that is at fault.
    let inserted = 0;
    for (const row of rows) {
      try {
        inserted += await target.$executeRawUnsafe(buildInsertSql(table, names, 1), ...row.values);
      } catch (err) {
        throw new MigrationError(`table "${table}", row ${row.rowId} (SQLite rowid): ${clean(err.message)}`);
      }
    }
    return inserted;
  }
}

/** Move the id sequence past max(id). Returns the max, or null when there is nothing to do. */
async function resetSequence(target, table) {
  const [m] = await target.$queryRawUnsafe(`SELECT max("id")::bigint AS max FROM ${quoteIdent(table)}`);
  if (m.max === null || m.max === undefined) return null;
  const [s] = await target.$queryRawUnsafe(
    "SELECT setval(pg_get_serial_sequence($1, 'id'), $2::bigint) AS v",
    quoteIdent(table),
    m.max,
  );
  return s.v === null ? null : Number(m.max);
}

async function copyTable({ source, target, table, columns, targetCols, batch, dryRun, clean }) {
  const sourceCount = source.prepare(`SELECT count(*) AS n FROM ${quoteIdent(table)}`).get().n;
  const targetBefore = await countRows(target, table);
  const size = batchSize(batch, columns.length);
  const colSql = columns.map((c) => quoteIdent(c.name)).join(', ');
  const first = source.prepare(`SELECT rowid AS __rowid, ${colSql} FROM ${quoteIdent(table)} ORDER BY rowid LIMIT ?`);
  const next = source.prepare(
    `SELECT rowid AS __rowid, ${colSql} FROM ${quoteIdent(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
  );

  let after = null;
  let copied = 0;
  let alreadyPresent = 0;
  for (;;) {
    const rows = after === null ? first.all(size) : next.all(after, size);
    if (rows.length === 0) break;
    const converted = rows.map((r) => ({
      rowId: r.__rowid,
      values: columns.map((c) => convertValue(r[c.name], c.dataType, { table, column: c.name, rowId: r.__rowid })),
    }));
    if (!dryRun) {
      const inserted = await insertBatch(target, table, columns, converted, clean);
      copied += inserted;
      alreadyPresent += converted.length - inserted;
    }
    after = rows[rows.length - 1].__rowid;
  }

  const hasIntegerId = targetCols.some((c) => c.name === 'id' && INTEGER_TYPES.has(c.dataType));
  if (dryRun) return { table, source: Number(sourceCount), targetBefore, copied: null, alreadyPresent: null, targetAfter: targetBefore, sequenceAt: null };
  const sequenceAt = hasIntegerId ? await resetSequence(target, table) : null;
  const targetAfter = await countRows(target, table);
  return { table, source: Number(sourceCount), targetBefore, copied, alreadyPresent, targetAfter, sequenceAt };
}

async function openTarget(to, dryRun, log) {
  if (!dryRun) return openPostgresUrl(to, { migrate: true });
  const existing = await openPostgresUrl(to, { migrate: false });
  const [{ ok }] = await existing.$queryRawUnsafe("SELECT to_regclass('_lcyt_migrations') IS NOT NULL AS ok");
  if (ok) return existing;
  await existing.close();
  log('target has no schema yet: validating against a throw-away schema (dropped afterwards)');
  return openPostgresUrl(to, { migrate: true, throwawaySchema: true });
}

/**
 * Run the copy. Throws MigrationError (already scrubbed of credentials) on the first failure.
 * @returns {Promise<{ ok: boolean, dryRun: boolean, rows: object[], skipped: object }>}
 */
export async function migrateSqliteToPostgres({ from, to, dryRun = false, batch = DEFAULT_BATCH, log = console.log }) {
  const clean = (text) => scrubSecrets(text, to);
  const source = new Database(resolve(from), { readonly: true, fileMustExist: true });
  let target = null;
  try {
    const src = readSourceCatalog(source);
    target = await openTarget(to, dryRun, log);
    const tgt = await readTargetCatalog(target);
    const plan = planCopy({ sourceTables: src.columns, targetTables: tgt.tables });
    const { order, cyclic } = orderTables(plan.copy.map((c) => c.table), [...src.edges, ...tgt.edges]);
    if (cyclic.length) log(`warning: foreign-key cycle among ${cyclic.join(', ')}; copied in name order, FK checks may fail`);
    if (plan.missingInSource.length) log(`skipped (not in SQLite source): ${plan.missingInSource.join(', ')}`);
    if (plan.ignoredInTarget.length) log(`ignored (not in PostgreSQL target schema): ${plan.ignoredInTarget.join(', ')}`);
    for (const note of plan.columnNotes) {
      if (note.onlyInSource.length) log(`${note.table}: SQLite-only columns not copied: ${note.onlyInSource.join(', ')}`);
      if (note.onlyInTarget.length) log(`${note.table}: target-only columns use their defaults: ${note.onlyInTarget.join(', ')}`);
    }

    const byName = new Map(plan.copy.map((c) => [c.table, c]));
    const rows = [];
    for (const table of order) {
      const entry = byName.get(table);
      const report = await copyTable({
        source,
        target,
        table,
        columns: entry.columns,
        targetCols: tgt.tables.get(table),
        batch,
        dryRun,
        clean,
      });
      rows.push(report);
      if (report.source > 0) {
        log(dryRun
          ? `validated ${table}: ${report.source} rows`
          : `copied ${table}: ${report.copied} new, ${report.alreadyPresent} already present, ${report.targetAfter} in target`);
      }
    }

    const ok = dryRun || rows.every((r) => r.targetAfter >= r.source);
    return {
      ok,
      dryRun,
      rows,
      skipped: { missingInSource: plan.missingInSource, ignoredInTarget: plan.ignoredInTarget, cyclic },
    };
  } catch (err) {
    throw new MigrationError(clean(err.message));
  } finally {
    source.close();
    if (target) await target.close();
  }
}

/* ------------------------------------------------------------------ command line */

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.help) {
      log(USAGE);
      return 0;
    }
    validateOptions(opts);
  } catch (err) {
    error(`error: ${err.message}`);
    error(USAGE);
    return 2;
  }

  log(`copying ${opts.from} -> ${maskUrl(opts.to)}${opts.dryRun ? ' (dry run, nothing is written)' : ''}`);
  try {
    const report = await migrateSqliteToPostgres({ ...opts, log });
    const table = report.dryRun
      ? report.rows.map((r) => ({ table: r.table, source_rows: r.source, target_rows_now: r.targetBefore, status: 'validated' }))
      : report.rows.map((r) => ({
        table: r.table,
        source_rows: r.source,
        copied: r.copied,
        already_present: r.alreadyPresent,
        target_total: r.targetAfter,
        match: r.targetAfter >= r.source ? 'yes' : 'NO',
      }));
    log('');
    log(formatTable(table));
    if (report.skipped.missingInSource.length) log(`\nskipped, not in SQLite source: ${report.skipped.missingInSource.join(', ')}`);
    if (report.skipped.ignoredInTarget.length) log(`ignored, not in target schema: ${report.skipped.ignoredInTarget.join(', ')}`);
    if (!report.ok) {
      error('error: target has fewer rows than the source for: '
        + report.rows.filter((r) => r.targetAfter < r.source).map((r) => r.table).join(', '));
      return 1;
    }
    log(report.dryRun ? '\ndry run: all rows convert' : '\ndone');
    return 0;
  } catch (err) {
    error(`error: ${err.message}`);
    return 1;
  }
}

const isEntry = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
  main().then((code) => {
    process.exitCode = code;
  });
}
