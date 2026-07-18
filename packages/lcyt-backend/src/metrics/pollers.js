/**
 * Background metric pollers (plan_metering_audit §4.2–4.3):
 *
 * - MediaMTX egress: per-path bytesSent deltas every 30 s. Path names are the
 *   api_key that created them, so attribution is direct. Per-path counters
 *   reset when a path is recreated — handled by counter-reset detection.
 * - Storage gauges: per-project caption-file and image bytes every 5 min.
 * - Orchestrator burst-VM accounting: polls GET /compute/burst/history totals
 *   every 60 s (system scope — burst capacity is not project-attributable).
 */
import logger from 'lcyt/logger';

/**
 * Counter-reset-safe delta: when the current reading is lower than the last
 * one the counter restarted, so the whole current value is new traffic.
 */
export function counterDelta(last, current) {
  if (!Number.isFinite(last)) return 0; // first observation seeds the baseline
  return current < last ? current : current - last;
}

export function createMediaMtxEgressPoller({ metrics, mediamtxClient, intervalMs = 30_000 }) {
  const lastByPath = new Map();

  async function poll() {
    let paths;
    try {
      paths = await mediamtxClient.listPaths();
    } catch {
      return; // MediaMTX down — try again next tick
    }
    const seen = new Set();
    for (const path of paths || []) {
      if (!path?.name) continue;
      seen.add(path.name);
      const current = Number(path.bytesSent || 0);
      const delta = counterDelta(lastByPath.get(path.name), current);
      lastByPath.set(path.name, current);
      if (delta > 0) metrics.count('egress.mediamtx_bytes', delta, { project: path.name });
    }
    // Drop baselines for removed paths so a recreated path re-seeds cleanly.
    for (const name of lastByPath.keys()) {
      if (!seen.has(name)) lastByPath.delete(name);
    }
  }

  const timer = setInterval(() => { poll().catch(() => {}); }, intervalMs);
  timer.unref();
  return { poll, stop: () => clearInterval(timer) };
}

export function createStorageGaugePoller({ db, metrics, intervalMs = 300_000 }) {
  function poll() {
    try {
      const rows = db.prepare(`
        SELECT api_key,
               COALESCE(SUM(CASE WHEN type = 'image' THEN size_bytes ELSE 0 END), 0) AS image_bytes,
               COALESCE(SUM(CASE WHEN type != 'image' OR type IS NULL THEN size_bytes ELSE 0 END), 0) AS file_bytes
        FROM caption_files GROUP BY api_key
      `).all();
      for (const row of rows) {
        metrics.gauge('storage.caption_files_bytes', row.file_bytes, { project: row.api_key });
        metrics.gauge('storage.images_bytes', row.image_bytes, { project: row.api_key });
      }
    } catch (err) {
      logger.warn('[metrics] storage gauge poll failed', err);
    }
  }

  const timer = setInterval(poll, intervalMs);
  timer.unref();
  return { poll, stop: () => clearInterval(timer) };
}

export function createBurstHistoryPoller({ metrics, orchestratorUrl, intervalMs = 60_000, fetchFn = fetch }) {
  let lastCreated = NaN;
  let lastVmSeconds = NaN;
  let latest = null; // cached for the /admin/metrics/live panel

  async function poll() {
    let body;
    try {
      const res = await fetchFn(`${orchestratorUrl.replace(/\/$/, '')}/compute/burst/history`);
      if (!res.ok) return;
      body = await res.json();
    } catch {
      return; // orchestrator down — try again next tick
    }
    latest = body;
    const totals = body?.totals || {};
    const createdDelta = counterDelta(lastCreated, Number(totals.created || 0));
    const secondsDelta = counterDelta(lastVmSeconds, Number(totals.vmSecondsTotal || 0));
    lastCreated = Number(totals.created || 0);
    lastVmSeconds = Number(totals.vmSecondsTotal || 0);
    if (createdDelta > 0) metrics.count('compute.burst_vms_created', createdDelta, { project: '' });
    if (secondsDelta > 0) metrics.count('compute.burst_vm_seconds', secondsDelta, { project: '' });
  }

  const timer = setInterval(() => { poll().catch(() => {}); }, intervalMs);
  timer.unref();
  return { poll, stop: () => clearInterval(timer), getLatest: () => latest };
}

/**
 * Wire up all pollers appropriate to this install. Returns handles so the
 * live-metrics endpoint can reach the burst poller's cache.
 */
export function startMetricsPollers({ db, metrics, mediamtxClient = null, orchestratorUrl = process.env.ORCHESTRATOR_URL || '' }) {
  const pollers = { storage: createStorageGaugePoller({ db, metrics }) };
  if (mediamtxClient) pollers.mediamtxEgress = createMediaMtxEgressPoller({ metrics, mediamtxClient });
  if (orchestratorUrl) pollers.burstHistory = createBurstHistoryPoller({ metrics, orchestratorUrl });
  return pollers;
}
