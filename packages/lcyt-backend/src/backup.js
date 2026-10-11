import { mkdir, rm, readdir, mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MAX_BACKUP_DAYS = 180;

/**
 * Parse and clamp the BACKUP_DAYS environment variable value.
 * Returns 0 (disabled) if the value is invalid, negative, or zero.
 * Caps the value at MAX_BACKUP_DAYS (180).
 * @param {string|number|undefined} value
 * @returns {number} 0 = disabled, 1–180 = retention days
 */
export function parseBackupDays(value) {
  const n = Math.trunc(Number(value ?? 0));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_BACKUP_DAYS);
}

/**
 * Create a date-stamped backup of the SQLite database in backupDir.
 * Uses better-sqlite3's built-in backup() method for a safe online copy.
 * @param {import('better-sqlite3').Database} db - Open database instance
 * @param {string|object} backupDir - Root backup directory (e.g. /backups), or an object store
 *   (`putFile`/`list`/`deletePrefix`, e.g. the S3 store). A store receives `<date>/lcyt-backend.db`.
 * @returns {Promise<string>} Path (or object key) where the backup was written
 */
export async function runBackup(db, backupDir) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (typeof backupDir !== 'string') {
    // Object store: write a local copy first (db.backup() needs a file), then upload it.
    const workDir = await mkdtemp(join(tmpdir(), 'lcyt-backup-'));
    try {
      const localCopy = join(workDir, 'lcyt-backend.db');
      await db.backup(localCopy);
      const key = `${today}/lcyt-backend.db`;
      const stored = await backupDir.putFile(key, localCopy, { contentType: 'application/vnd.sqlite3' });
      const { size } = await stat(localCopy);
      if (stored?.size != null && stored.size !== size) {
        throw new Error(`Uploaded backup size ${stored.size} does not match local size ${size}`);
      }
      return key;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  const dir = join(backupDir, today);
  await mkdir(dir, { recursive: true });
  await db.backup(join(dir, 'lcyt-backend.db'));
  return dir;
}

/**
 * Remove backup directories older than backupDays days.
 * Only removes directories whose names match YYYY-MM-DD format.
 * Does nothing if backupDays is 0 (disabled).
 * @param {string|object} backupDir - Root backup directory, or an object store
 * @param {number} backupDays - Retention period in days (0 = no-op)
 * @returns {Promise<number>} Number of directories removed
 */
export async function cleanOldBackups(backupDir, backupDays) {
  if (backupDays <= 0) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - backupDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  if (typeof backupDir !== 'string') {
    const dates = new Set();
    let cursor = null;
    do {
      const page = await backupDir.list('', { limit: 1000, cursor });
      for (const item of page.items) {
        const date = item.key.split('/')[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < cutoffStr) dates.add(date);
      }
      cursor = page.nextCursor;
    } while (cursor);
    for (const date of dates) await backupDir.deletePrefix(`${date}/`);
    return dates.size;
  }

  let removed = 0;
  let entries;
  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    if (entry.name < cutoffStr) {
      await rm(join(backupDir, entry.name), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
