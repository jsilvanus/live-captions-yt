/**
 * TEST-ONLY synchronous-looking SQL helpers for the Prisma client: db.exec(sql) and
 * db.prepare(sql).run/get/all(...params), all returning Promises. Installed by initDb() when
 * LCYT_DB_SQL_COMPAT=1 (set by the test scripts) so tests can seed and inspect rows with plain SQL
 * on both SQLite and PostgreSQL. Production code must use the Prisma API.
 *
 * Small dialect translation: `?` -> `$n` on PostgreSQL, datetime('now'[, '-N days']) -> literal,
 * INSERT OR IGNORE -> ON CONFLICT DO NOTHING, PRAGMA foreign_keys -> no-op on PostgreSQL.
 */
import { sqlNow } from './helpers.js';

function translate(sql, dialect) {
  let out = sql.replace(/datetime\('now'(?:\s*,\s*'(-?\d+) days')?\)/g, (_m, days) => {
    const d = new Date(Date.now() + (days ? Number(days) * 86_400_000 : 0));
    return `'${sqlNow(d)}'`;
  });
  if (dialect === 'postgres') {
    if (/INSERT\s+OR\s+IGNORE/i.test(out)) out = `${out.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT').replace(/;?\s*$/, '')} ON CONFLICT DO NOTHING`;
    let n = 0;
    out = out.replace(/\?/g, () => `$${++n}`);
  }
  return out;
}

const norm = (v) => (typeof v === 'bigint' ? Number(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const normParams = (params) => params.flat().map(norm);
const normRow = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, norm(v)])) : row);

export function installSqlCompat(db, dialect) {
  const isPg = dialect === 'postgres';

  db.exec = async (sql) => {
    if (isPg && /^\s*PRAGMA/i.test(sql)) return;
    for (const stmt of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(translate(stmt, dialect));
    }
  };

  db.pragma = async () => [];

  db.prepare = (sql) => {
    const text = translate(sql, dialect);
    const isRead = /^\s*(SELECT|WITH|PRAGMA)/i.test(text) || /\bRETURNING\b/i.test(text);
    const isPragmaNoop = isPg && /^\s*PRAGMA/i.test(text);
    return {
      all: async (...params) => (isPragmaNoop ? [] : (await db.$queryRawUnsafe(text, ...normParams(params))).map(normRow)),
      get: async (...params) => (isPragmaNoop ? undefined : normRow((await db.$queryRawUnsafe(text, ...normParams(params)))[0])),
      run: async (...params) => {
        if (isPragmaNoop) return { changes: 0, lastInsertRowid: 0 };
        const p = normParams(params);
        if (isRead) { const rows = await db.$queryRawUnsafe(text, ...p); return { changes: rows.length, lastInsertRowid: 0 }; }
        if (/^\s*INSERT/i.test(text) && !/RETURNING/i.test(text)) {
          if (isPg) {
            try {
              const rows = await db.$queryRawUnsafe(`${text.replace(/;?\s*$/, '')} RETURNING id`, ...p);
              return { changes: rows.length, lastInsertRowid: norm(rows[0]?.id) ?? 0 };
            } catch (err) {
              if (!/column "id" does not exist/.test(String(err.message))) throw err;
            }
          } else {
            const changes = await db.$executeRawUnsafe(text, ...p);
            const [row] = await db.$queryRawUnsafe('SELECT last_insert_rowid() AS id');
            return { changes, lastInsertRowid: norm(row?.id) };
          }
        }
        return { changes: await db.$executeRawUnsafe(text, ...p), lastInsertRowid: 0 };
      },
    };
  };

  db.transaction = (fn) => async (...args) => fn(...args);
  return db;
}
