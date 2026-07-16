import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import { createUsageBuffer } from './metrics/buffer.js';
import { queryUsageRollups } from './db/usage-rollups.js';

let activeMetrics = null;

function normalizeMetricName(metric) {
  return metric.replace(/[^a-zA-Z0-9_:.-]+/g, '_').replace(/\.+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

export function createMetrics(db) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const buffer = createUsageBuffer({ db });
  const counters = new Map();
  const gauges = new Map();

  function getOrCreateCounter(metric, labels = []) {
    const name = normalizeMetricName(metric);
    const existing = counters.get(name);
    if (existing) return existing;
    const counter = new Counter({
      name: `lcyt_${name}_total`,
      help: `Counter for ${metric}`,
      labelNames: labels,
      registers: [registry],
    });
    counters.set(name, counter);
    return counter;
  }

  function getOrCreateGauge(metric, labels = []) {
    const name = normalizeMetricName(metric);
    const existing = gauges.get(name);
    if (existing) return existing;
    const gauge = new Gauge({
      name: `lcyt_${name}`,
      help: `Gauge for ${metric}`,
      labelNames: labels,
      registers: [registry],
    });
    gauges.set(name, gauge);
    return gauge;
  }

  function count(metric, value = 1, labels = {}) {
    const project = labels.project || labels.apiKey || '';
    buffer.record({ apiKey: project, metric, value, kind: 'counter' });
    const counter = getOrCreateCounter(metric, ['project']);
    counter.inc({ project: project || 'system' }, Number(value || 0));
  }

  function gauge(metric, value, labels = {}) {
    const project = labels.project || labels.apiKey || '';
    buffer.record({ apiKey: project, metric, value, kind: 'gauge' });
    const metricGauge = getOrCreateGauge(metric, ['project']);
    metricGauge.set({ project: project || 'system' }, Number(value || 0));
  }

  function max(metric, value, labels = {}) {
    const project = labels.project || labels.apiKey || '';
    buffer.record({ apiKey: project, metric, value, kind: 'max' });
    const metricGauge = getOrCreateGauge(metric, ['project']);
    metricGauge.set({ project: project || 'system' }, Number(value || 0));
  }

  return {
    count,
    gauge,
    max,
    registry,
    getMetricsText() {
      return registry.metrics();
    },
    flushNow() {
      return buffer.flushNow();
    },
    stop() {
      buffer.stop();
    },
    queryUsageRollups(opts = {}) {
      return queryUsageRollups(db, opts);
    },
  };
}

export function setMetricsInstance(metrics) {
  activeMetrics = metrics;
  return metrics;
}

export function getMetricsInstance() {
  return activeMetrics;
}
