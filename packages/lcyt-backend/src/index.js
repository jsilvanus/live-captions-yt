import { app, db, store, relayManager, radioManager, hlsManager, hlsSubsManager, previewManager, stopDsk, musicManager, metrics } from './server.js';
import { cleanRevokedKeys } from './db.js';
import { deleteBusEventsOlderThan } from './db/bus-events.js';
import { deleteAuditLogOlderThan } from './db/audit-log.js';
import { compactHourlyRollups } from './db/usage-rollups.js';
import { kindForMetric } from './metrics/registry.js';
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
// Event-bus audit log retention (mirrors the revoked-key cleanup pattern)
// ---------------------------------------------------------------------------

const EVENT_LOG_RETENTION_DAYS = Number(process.env.EVENT_LOG_RETENTION_DAYS ?? 30);
const EVENT_LOG_CLEANUP_INTERVAL = Number(process.env.EVENT_LOG_CLEANUP_INTERVAL ?? 86_400_000);

if (EVENT_LOG_RETENTION_DAYS > 0) {
  const busEventsTimer = setInterval(() => {
    const { count } = deleteBusEventsOlderThan(db, EVENT_LOG_RETENTION_DAYS);
    if (count > 0) console.log(`[cleanup] Purged ${count} bus event(s) older than ${EVENT_LOG_RETENTION_DAYS} days`);
  }, EVENT_LOG_CLEANUP_INTERVAL);
  busEventsTimer.unref();
}

// ---------------------------------------------------------------------------
// Usage-rollup compaction + audit-log / stats retention (plan_metering_audit §3.5, §5.5)
// ---------------------------------------------------------------------------

const USAGE_ROLLUP_HOURLY_RETENTION_DAYS = Number(process.env.USAGE_ROLLUP_HOURLY_RETENTION_DAYS ?? 90);
const AUDIT_LOG_RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 365);
// Opt-in sweep of the historical per-fact stats tables; 0 = keep forever.
const STATS_RETENTION_DAYS = Number(process.env.STATS_RETENTION_DAYS ?? 0);
const ROLLUP_MAINTENANCE_INTERVAL = Number(process.env.ROLLUP_MAINTENANCE_INTERVAL ?? 86_400_000);

// caption_usage is deliberately excluded: it is the quota source of truth.
// `type` picks the cutoff representation: ISO timestamp string, date-only
// string, or unix seconds (cue_events/music_events store INTEGER ts).
const STATS_TABLES = [
  { table: 'session_stats', column: 'started_at', type: 'iso' },
  { table: 'caption_errors', column: 'timestamp', type: 'iso' },
  { table: 'auth_events', column: 'timestamp', type: 'iso' },
  { table: 'domain_hourly_stats', column: 'date', type: 'date' },
  { table: 'viewer_key_daily_stats', column: 'date', type: 'date' },
  { table: 'viewer_anon_daily_stats', column: 'date', type: 'date' },
  { table: 'rtmp_stream_stats', column: 'started_at', type: 'iso' },
  { table: 'rtmp_anon_daily_stats', column: 'date', type: 'date' },
  { table: 'cue_events', column: 'ts', type: 'unixSeconds' },
  { table: 'agent_events', column: 'created_at', type: 'iso' },
  { table: 'music_events', column: 'ts', type: 'unixSeconds' },
];

function runRollupMaintenance() {
  if (USAGE_ROLLUP_HOURLY_RETENTION_DAYS > 0) {
    try {
      const compacted = compactHourlyRollups(db, { olderThanDays: USAGE_ROLLUP_HOURLY_RETENTION_DAYS, kindForMetric });
      if (compacted > 0) console.log(`[cleanup] Compacted ${compacted} hourly usage rollup(s) into daily rows`);
    } catch (err) {
      console.error('[cleanup] Rollup compaction failed:', err.message);
    }
  }
  if (AUDIT_LOG_RETENTION_DAYS > 0) {
    try {
      const { count } = deleteAuditLogOlderThan(db, AUDIT_LOG_RETENTION_DAYS);
      if (count > 0) console.log(`[cleanup] Purged ${count} audit log row(s) older than ${AUDIT_LOG_RETENTION_DAYS} days`);
    } catch (err) {
      console.error('[cleanup] Audit log retention failed:', err.message);
    }
  }
  if (STATS_RETENTION_DAYS > 0) {
    const cutoffMs = Date.now() - STATS_RETENTION_DAYS * 86_400_000;
    const cutoffs = {
      iso: new Date(cutoffMs).toISOString(),
      date: new Date(cutoffMs).toISOString().slice(0, 10),
      unixSeconds: Math.floor(cutoffMs / 1000),
    };
    for (const { table, column, type } of STATS_TABLES) {
      try {
        const info = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).run(cutoffs[type]);
        if (info.changes > 0) console.log(`[cleanup] Purged ${info.changes} row(s) from ${table} older than ${STATS_RETENTION_DAYS} days`);
      } catch {
        // Table may not exist on this install (plugin not migrated) — skip.
      }
    }
  }
}

const rollupMaintenanceTimer = setInterval(runRollupMaintenance, ROLLUP_MAINTENANCE_INTERVAL);
rollupMaintenanceTimer.unref();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log('Shutting down...');
  await stopDsk();
  await relayManager.stopAll();
  await radioManager.stopAll();
  await hlsManager.stopAll();
  await hlsSubsManager.stopAll();
  await previewManager.stopAll();
  if (musicManager) await musicManager.stopAll();
  for (const session of store.all()) {
    try { await session.sender.end(); } catch {}
  }
  store.stopCleanup();
  // Drain buffered usage rollups before the DB handle goes away.
  try { metrics.flushNow(); } catch {}
  metrics.stop();
  db.close();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
