import logger from 'lcyt/logger';
import { normalizePeriodStart, writeUsageRollup } from '../db/usage-rollups.js';

const DEFAULT_FLUSH_INTERVAL_MS = Number(process.env.USAGE_FLUSH_INTERVAL_MS || 15_000);

function makeKey({ apiKey = '', metric, grain = 'hour', periodStart }) {
  return `${apiKey}\x00${metric}\x00${grain}\x00${periodStart || ''}`;
}

export function createUsageBuffer({ db, flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS } = {}) {
  const pending = new Map();
  let timer = null;

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushNow().catch(() => {});
    }, flushIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function record({ apiKey = '', metric, value = 1, kind = 'counter', grain = 'hour', periodStart } = {}) {
    const resolvedPeriodStart = periodStart || normalizePeriodStart(grain);
    const key = makeKey({ apiKey, metric, grain, periodStart: resolvedPeriodStart });
    const current = pending.get(key) || { apiKey, metric, kind, grain, periodStart: resolvedPeriodStart, value: 0 };
    current.value += Number(value || 0);
    pending.set(key, current);
    scheduleFlush();
  }

  function flushNow() {
    if (pending.size === 0) return Promise.resolve(0);
    const entries = Array.from(pending.values());
    pending.clear();
    return Promise.resolve().then(() => {
      try {
        db.transaction(() => {
          for (const entry of entries) {
            writeUsageRollup(db, {
              apiKey: entry.apiKey,
              metric: entry.metric,
              value: entry.value,
              kind: entry.kind,
              grain: entry.grain,
              periodStart: entry.periodStart,
            });
          }
        })();
      } catch (err) {
        // Swallow flush errors so caller hot paths never fail.
        logger.warn('[metrics] flush failed', err);
        for (const entry of entries) {
          const key = makeKey({ apiKey: entry.apiKey, metric: entry.metric, grain: entry.grain, periodStart: entry.periodStart });
          pending.set(key, entry);
        }
      }
    });
  }

  return {
    record,
    flushNow,
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
