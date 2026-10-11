/**
 * Get the current UTC date string and hour.
 * @returns {{ date: string, hour: number }}
 */
export function currentDateHour() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    hour: now.getUTCHours(),
  };
}

/**
 * UTC timestamp in the same text format SQLite's datetime('now') produces ('YYYY-MM-DD HH:MM:SS').
 * Used instead of SQL-side now() so queries behave the same on SQLite and PostgreSQL.
 * @param {Date} [d]
 */
export function sqlNow(d = new Date()) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Prisma returns BigInt for BigInt columns and raw COUNT()/SUM(); API code wants plain numbers. */
export function num(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}
