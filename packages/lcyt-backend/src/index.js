import logger from 'lcyt/logger';
import { app, db, store, settings, relayManager, radioManager, hlsManager, hlsSubsManager, previewManager, stopDsk, musicManager, metrics } from './server.js';
import { cleanRevokedKeys } from './db.js';
import { deleteBusEventsOlderThan } from './db/bus-events.js';
import { deleteAuditLogOlderThan } from './db/audit-log.js';
import { compactHourlyRollups } from './db/usage-rollups.js';
import { kindForMetric } from './metrics/registry.js';
import { parseBackupDays, runBackup, cleanOldBackups } from './backup.js';

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
  logger.info(`Listening on port ${PORT}`);
});

/**
 * A `setInterval` whose delay is re-read from `getIntervalMs()` before each
 * firing (via recursive `setTimeout`) instead of frozen once at creation, so
 * a DB-saved retention/cleanup-interval setting takes effect within one
 * cycle — no restart, no explicit `settings.changed` subscription needed.
 * Starting/stopping the loop itself (e.g. a retention count going from 0 to
 * enabled) still requires a restart — the `if (…Days > 0)` gate below is
 * only evaluated once, at boot.
 */
function scheduleRearmable(getIntervalMs, fn) {
  let timer;
  function tick() {
    try { fn(); } finally {
      timer = setTimeout(tick, getIntervalMs());
      timer.unref();
    }
  }
  timer = setTimeout(tick, getIntervalMs());
  timer.unref();
  return () => clearTimeout(timer);
}

// ---------------------------------------------------------------------------
// Database backup
// ---------------------------------------------------------------------------

const BACKUP_DAYS = parseBackupDays(settings.get('retention.backup_days')); // caps at MAX_BACKUP_DAYS
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups'; // Tier A path

if (BACKUP_DAYS > 0) {
  async function doBackup() {
    try {
      const dir = await runBackup(db, BACKUP_DIR);
      logger.info(`[backup] Saved database to ${dir}`);
      const days = parseBackupDays(settings.get('retention.backup_days'));
      const removed = await cleanOldBackups(BACKUP_DIR, days);
      if (removed > 0) logger.info(`[backup] Removed ${removed} backup(s) older than ${days} days`);
    } catch (err) {
      logger.error('[backup] Error:', err.message);
    }
  }
  doBackup();
  scheduleRearmable(() => 86_400_000, doBackup); // 24h — not itself a registry setting
}

// ---------------------------------------------------------------------------
// Revoked key cleanup
// ---------------------------------------------------------------------------

if (settings.get('retention.revoked_key_ttl_days') > 0) {
  scheduleRearmable(() => settings.get('retention.revoked_key_cleanup_interval'), () => {
    const days = settings.get('retention.revoked_key_ttl_days');
    if (days <= 0) return;
    const { count } = cleanRevokedKeys(db, days);
    if (count > 0) logger.info(`[cleanup] Purged ${count} revoked key(s) older than ${days} days`);
  });
}

// ---------------------------------------------------------------------------
// Event-bus audit log retention (mirrors the revoked-key cleanup pattern)
// ---------------------------------------------------------------------------

if (settings.get('retention.event_log_retention_days') > 0) {
  scheduleRearmable(() => settings.get('retention.event_log_cleanup_interval'), () => {
    const days = settings.get('retention.event_log_retention_days');
    if (days <= 0) return;
    const { count } = deleteBusEventsOlderThan(db, days);
    if (count > 0) logger.info(`[cleanup] Purged ${count} bus event(s) older than ${days} days`);
  });
}

// ---------------------------------------------------------------------------
// Usage-rollup compaction + audit-log / stats retention (plan_metering_audit §3.5, §5.5)
// ---------------------------------------------------------------------------

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
  const usageRollupHourlyRetentionDays = settings.get('retention.usage_rollup_hourly_retention_days');
  const auditLogRetentionDays = settings.get('retention.audit_log_retention_days');
  const statsRetentionDays = settings.get('retention.stats_retention_days');

  if (usageRollupHourlyRetentionDays > 0) {
    try {
      const compacted = compactHourlyRollups(db, { olderThanDays: usageRollupHourlyRetentionDays, kindForMetric });
      if (compacted > 0) logger.info(`[cleanup] Compacted ${compacted} hourly usage rollup(s) into daily rows`);
    } catch (err) {
      logger.error('[cleanup] Rollup compaction failed:', err.message);
    }
  }
  if (auditLogRetentionDays > 0) {
    try {
      const { count } = deleteAuditLogOlderThan(db, auditLogRetentionDays);
      if (count > 0) logger.info(`[cleanup] Purged ${count} audit log row(s) older than ${auditLogRetentionDays} days`);
    } catch (err) {
      logger.error('[cleanup] Audit log retention failed:', err.message);
    }
  }
  if (statsRetentionDays > 0) {
    const cutoffMs = Date.now() - statsRetentionDays * 86_400_000;
    const cutoffs = {
      iso: new Date(cutoffMs).toISOString(),
      date: new Date(cutoffMs).toISOString().slice(0, 10),
      unixSeconds: Math.floor(cutoffMs / 1000),
    };
    for (const { table, column, type } of STATS_TABLES) {
      try {
        const info = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).run(cutoffs[type]);
        if (info.changes > 0) logger.info(`[cleanup] Purged ${info.changes} row(s) from ${table} older than ${statsRetentionDays} days`);
      } catch {
        // Table may not exist on this install (plugin not migrated) — skip.
      }
    }
  }
}

scheduleRearmable(() => settings.get('retention.rollup_maintenance_interval'), runRollupMaintenance);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  logger.info('Shutting down...');
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
