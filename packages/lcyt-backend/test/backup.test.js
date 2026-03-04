import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseBackupDays, runBackup, cleanOldBackups } from '../src/backup.js';
import { initDb } from '../src/db.js';

// ---------------------------------------------------------------------------
// parseBackupDays
// ---------------------------------------------------------------------------

describe('parseBackupDays', () => {
  it('returns 0 for undefined', () => assert.strictEqual(parseBackupDays(undefined), 0));
  it('returns 0 for "0"', () => assert.strictEqual(parseBackupDays('0'), 0));
  it('returns 0 for negative values', () => assert.strictEqual(parseBackupDays('-5'), 0));
  it('returns 0 for non-numeric strings', () => assert.strictEqual(parseBackupDays('abc'), 0));
  it('returns 0 for NaN', () => assert.strictEqual(parseBackupDays(NaN), 0));
  it('returns the value for a valid positive integer', () => assert.strictEqual(parseBackupDays('30'), 30));
  it('caps at 180 for values exceeding the maximum', () => assert.strictEqual(parseBackupDays('999'), 180));
  it('returns 180 for exactly 180', () => assert.strictEqual(parseBackupDays('180'), 180));
  it('truncates decimals', () => assert.strictEqual(parseBackupDays('7.9'), 7));
});

// ---------------------------------------------------------------------------
// runBackup and cleanOldBackups
// ---------------------------------------------------------------------------

describe('runBackup', () => {
  let tmpDir;
  let db;

  before(async () => {
    tmpDir = join(tmpdir(), `lcyt-backup-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    db = initDb(':memory:');
  });

  after(async () => {
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a date-stamped subdirectory and database file', async () => {
    const dir = await runBackup(db, tmpDir);
    const today = new Date().toISOString().slice(0, 10);

    assert.ok(dir.endsWith(today), `Expected dir to end with ${today}, got ${dir}`);

    const { existsSync } = await import('node:fs');
    assert.ok(existsSync(join(dir, 'lcyt-backend.db')), 'Backup file should exist');
  });

  it('is idempotent — running twice on the same day overwrites without error', async () => {
    await assert.doesNotReject(() => runBackup(db, tmpDir));
    await assert.doesNotReject(() => runBackup(db, tmpDir));
  });
});

describe('cleanOldBackups', () => {
  let tmpDir;

  before(async () => {
    tmpDir = join(tmpdir(), `lcyt-clean-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function makeDir(name) {
    const p = join(tmpDir, name);
    await mkdir(p, { recursive: true });
    await writeFile(join(p, 'lcyt-backend.db'), '');
    return p;
  }

  it('returns 0 when backupDays is 0 (disabled)', async () => {
    const removed = await cleanOldBackups(tmpDir, 0);
    assert.strictEqual(removed, 0);
  });

  it('returns 0 when backup directory does not exist', async () => {
    const missing = join(tmpDir, 'does-not-exist');
    const removed = await cleanOldBackups(missing, 7);
    assert.strictEqual(removed, 0);
  });

  it('removes directories older than the retention window', async () => {
    // Create a directory that is definitely in the past (2000-01-01)
    await makeDir('2000-01-01');
    const removed = await cleanOldBackups(tmpDir, 7);
    assert.ok(removed >= 1, 'Should have removed at least one old directory');

    const { existsSync } = await import('node:fs');
    assert.ok(!existsSync(join(tmpDir, '2000-01-01')), 'Old directory should be gone');
  });

  it('keeps directories within the retention window', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await makeDir(today);

    const before = (await import('node:fs')).readdirSync(tmpDir);
    await cleanOldBackups(tmpDir, 7);
    const after = (await import('node:fs')).readdirSync(tmpDir);

    assert.ok(after.includes(today), 'Today\'s backup should be kept');
    assert.deepStrictEqual(before.length, after.length);
  });

  it('ignores entries that do not match YYYY-MM-DD format', async () => {
    const odd = join(tmpDir, 'not-a-date');
    await mkdir(odd, { recursive: true });

    await cleanOldBackups(tmpDir, 7);

    const { existsSync } = await import('node:fs');
    assert.ok(existsSync(odd), 'Non-date directory should be left untouched');
    await rm(odd, { recursive: true, force: true });
  });
});
