import { app, db, store, relayManager, radioManager, hlsManager, hlsSubsManager, previewManager, stopDskRenderer } from './server.js';
import { cleanRevokedKeys } from './db.js';
import { parseBackupDays, runBackup, cleanOldBackups } from './backup.js';

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Database backup
// ---------------------------------------------------------------------------

const BACKUP_DAYS = parseBackupDays(process.env.BACKUP_DAYS);
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const BACKUP_INTERVAL = 86_400_000; // 24 h

if (BACKUP_DAYS > 0) {
  async function doBackup() {
    try {
      const dir = await runBackup(db, BACKUP_DIR);
      console.log(`[backup] Saved database to ${dir}`);
      const removed = await cleanOldBackups(BACKUP_DIR, BACKUP_DAYS);
      if (removed > 0) console.log(`[backup] Removed ${removed} backup(s) older than ${BACKUP_DAYS} days`);
    } catch (err) {
      console.error('[backup] Error:', err.message);
    }
  }
  doBackup();
  const backupTimer = setInterval(doBackup, BACKUP_INTERVAL);
  // unref() prevents the timer from keeping the process alive during graceful shutdown
  backupTimer.unref();
}

// ---------------------------------------------------------------------------
// Revoked key cleanup
// ---------------------------------------------------------------------------

const REVOKED_KEY_TTL_DAYS = Number(process.env.REVOKED_KEY_TTL_DAYS ?? 30);
const REVOKED_KEY_CLEANUP_INTERVAL = Number(process.env.REVOKED_KEY_CLEANUP_INTERVAL ?? 86_400_000);

if (REVOKED_KEY_TTL_DAYS > 0) {
  const cleanupTimer = setInterval(() => {
    const { count } = cleanRevokedKeys(db, REVOKED_KEY_TTL_DAYS);
    if (count > 0) console.log(`[cleanup] Purged ${count} revoked key(s) older than ${REVOKED_KEY_TTL_DAYS} days`);
  }, REVOKED_KEY_CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log('Shutting down...');
  await stopDskRenderer();
  await relayManager.stopAll();
  await radioManager.stopAll();
  await hlsManager.stopAll();
  await hlsSubsManager.stopAll();
  await previewManager.stopAll();
  for (const session of store.all()) {
    try { await session.sender.end(); } catch {}
  }
  store.stopCleanup();
  db.close();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
