import logger from 'lcyt/logger';
import { normalizePeriodStart, writeUsageRollup } from '../db/usage-rollups.js';

const DEFAULT_FLUSH_INTERVAL_MS = Number(process.env.USAGE_FLUSH_INTERVAL_MS || 15_000);

function makeKey({ apiKey = '', metric, grain = 'hour', periodStart }) {
  return `${apiKey}\x00${metric}\x00${grain}\x00${periodStart || ''}`;
}

// In-buffer merge must mirror the DB UPSERT semantics per kind: counters
// accumulate, gauges keep the latest value, max keeps the largest.
function mergeValue(kind, currentValue, incomingValue) {
  if (kind === 'gauge') return incomingValue;
  if (kind === 'max') return Math.max(currentValue, incomingValue);
  return currentValue + incomingValue;
}

export function createUsageBuffer({ db, flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS } = {}) {
  const pending = new Map();
  let timer = null;

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushNow();
    }, flushIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function record({ apiKey = '', metric, value = 1, kind = 'counter', grain = 'hour', periodStart } = {}) {
    const resolvedPeriodStart = periodStart || normalizePeriodStart(grain);
    const key = makeKey({ apiKey, metric, grain, periodStart: resolvedPeriodStart });
    const incoming = Number(value || 0);
    const current = pending.get(key);
    if (current) {
      current.value = mergeValue(kind, current.value, incoming);
    } else {
      pending.set(key, { apiKey, metric, kind, grain, periodStart: resolvedPeriodStart, value: incoming });
    }
    scheduleFlush();
  }

  function flushNow() {
    if (pending.size === 0) return 0;
    const entries = Array.from(pending.values());
    pending.clear();
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
      return entries.length;
    } catch (err) {
      // Swallow flush errors so caller hot paths never fail; put the entries
      // back (merging with anything recorded meanwhile) for the next attempt.
      logger.warn('[metrics] flush failed', err);
      for (const entry of entries) {
        const key = makeKey(entry);
        const existing = pending.get(key);
        if (existing) {
          // `entry` is older than `existing`: for gauges the newer value wins.
          if (entry.kind !== 'gauge') existing.value = mergeValue(entry.kind, existing.value, entry.value);
        } else {
          pending.set(key, entry);
        }
      }
      scheduleFlush();
      return 0;
    }
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
