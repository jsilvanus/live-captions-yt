/**
 * Admin metrics routes (plan_metering_audit §6.1). Mounted at /admin/metrics
 * behind the same admin middleware as the rest of the admin panel.
 *
 *   GET /admin/metrics/rollups?from&to&grain=hour|day&metrics=a,b&groupBy=metric|project|org
 *     → { series: [{ key, metric, points: [[period, value], …] }] }
 *   GET /admin/metrics/live
 *     → "right now" panel: active sessions, running ffmpeg by purpose,
 *       SSE connection counts, burst VMs. No Prometheus dependency.
 */
import { Router } from 'express';
import { queryRollupSeries } from '../db/usage-rollups.js';
import { METRIC_CATALOG } from '../metrics/registry.js';
import { getRunningFfmpegCounts } from '../ffmpeg/index.js';

export function createAdminMetricsRouter(db, { store = null, metrics = null, metricsPollers = {} } = {}) {
  const router = Router();

  router.get('/rollups', (req, res) => {
    const grain = req.query.grain === 'day' ? 'day' : 'hour';
    const groupBy = ['metric', 'project', 'org'].includes(req.query.groupBy) ? req.query.groupBy : 'metric';
    const metricsFilter = (req.query.metrics || '').split(',').map(s => s.trim()).filter(Boolean);
    const series = queryRollupSeries(db, {
      from: (req.query.from || '').trim(),
      to: (req.query.to || '').trim(),
      grain,
      metrics: metricsFilter,
      groupBy,
    });
    res.json({ series, catalog: METRIC_CATALOG });
  });

  router.get('/live', (req, res) => {
    res.json({
      activeSessions: store ? store.size() : 0,
      ffmpeg: getRunningFfmpegCounts(),
      sse: metrics ? metrics.getSseCounts() : {},
      burst: metricsPollers.burstHistory ? metricsPollers.burstHistory.getLatest() : null,
      ts: Date.now(),
    });
  });

  return router;
}
