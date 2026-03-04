import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

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
 * @param {string} backupDir - Root backup directory (e.g. /backups)
 * @returns {Promise<string>} Path of the directory where the backup was written
 */
export async function runBackup(db, backupDir) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = join(backupDir, today);
  await mkdir(dir, { recursive: true });
  await db.backup(join(dir, 'lcyt-backend.db'));
  return dir;
}

/**
 * Remove backup directories older than backupDays days.
 * Only removes directories whose names match YYYY-MM-DD format.
 * Does nothing if backupDays is 0 (disabled).
 * @param {string} backupDir - Root backup directory
 * @param {number} backupDays - Retention period in days (0 = no-op)
 * @returns {Promise<number>} Number of directories removed
 */
export async function cleanOldBackups(backupDir, backupDays) {
  if (backupDays <= 0) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - backupDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

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
