/**
 * Backend metrics facade (plan_metering_audit §4.1).
 *
 * One hook, two sinks: every count/gauge/max call feeds both the in-memory
 * usage-rollup buffer (billing-grade, flushed to SQLite) and the prom-client
 * registry (ops-grade projection, exposed on GET /metrics).
 */
import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import { createUsageBuffer } from './buffer.js';
import { METRIC_CATALOG, kindForMetric } from './registry.js';

let activeMetrics = null;

function promName(metric) {
  return metric.replace(/[^a-zA-Z0-9_:]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

export function createMetrics(db, settings = null) {
  const promRegistry = new Registry();
  collectDefaultMetrics({ register: promRegistry });
  const buffer = createUsageBuffer({ db });
  const counters = new Map();
  const gauges = new Map();
  const sseGauges = new Map();
  // Bounded-cardinality guard: label business series by project unless opted out.
  const projectLabels = settings ? settings.get('metrics.project_labels') : (process.env.METRICS_PROJECT_LABELS !== '0');

  function projectLabel(labels = {}) {
    if (!projectLabels) return 'all';
    return labels.project || labels.apiKey || 'system';
  }

  function projectKey(labels = {}) {
    const project = labels.project || labels.apiKey || '';
    return project === 'system' ? '' : project;
  }

  function getOrCreateCounter(metric) {
    const name = promName(metric);
    let counter = counters.get(name);
    if (!counter) {
      counter = new Counter({
        name: `lcyt_${name}_total`,
        help: `Counter for ${metric}`,
        labelNames: ['project'],
        registers: [promRegistry],
      });
      counters.set(name, counter);
    }
    return counter;
  }

  function getOrCreateGauge(metric) {
    const name = promName(metric);
    let gauge = gauges.get(name);
    if (!gauge) {
      gauge = new Gauge({
        name: `lcyt_${name}`,
        help: `Gauge for ${metric}`,
        labelNames: ['project'],
        registers: [promRegistry],
      });
      gauges.set(name, gauge);
    }
    return gauge;
  }

  function count(metric, value = 1, labels = {}) {
    buffer.record({ apiKey: projectKey(labels), metric, value, kind: 'counter' });
    getOrCreateCounter(metric).inc({ project: projectLabel(labels) }, Number(value || 0));
  }

  function gauge(metric, value, labels = {}) {
    buffer.record({ apiKey: projectKey(labels), metric, value, kind: 'gauge' });
    getOrCreateGauge(metric).set({ project: projectLabel(labels) }, Number(value || 0));
  }

  function max(metric, value, labels = {}) {
    buffer.record({ apiKey: projectKey(labels), metric, value, kind: 'max' });
    getOrCreateGauge(metric).set({ project: projectLabel(labels) }, Number(value || 0));
  }

  /** Report a finished ffmpeg process: wall-clock seconds by purpose. */
  function ffmpeg({ purpose = 'unknown', apiKey = '', seconds = 0 } = {}) {
    count(`ffmpeg.process_seconds.${purpose}`, seconds, { project: apiKey });
  }

  // Lazily-read connection gauges for the SSE registries; values are read at
  // Prometheus collect time and by the /admin/metrics/live panel.
  const sseGauge = new Gauge({
    name: 'lcyt_sse_connections',
    help: 'Open SSE connections per channel',
    labelNames: ['channel'],
    registers: [promRegistry],
    collect() {
      for (const [channel, sizeFn] of sseGauges) {
        try {
          this.set({ channel }, Number(sizeFn()) || 0);
        } catch {
          /* a broken size fn must not break scraping */
        }
      }
    },
  });
  void sseGauge;

  function setSseGauge(name, sizeFn) {
    if (typeof sizeFn === 'function') sseGauges.set(name, sizeFn);
  }

  function getSseCounts() {
    const out = {};
    for (const [channel, sizeFn] of sseGauges) {
      try {
        out[channel] = Number(sizeFn()) || 0;
      } catch {
        out[channel] = 0;
      }
    }
    return out;
  }

  return {
    count,
    gauge,
    max,
    ffmpeg,
    setSseGauge,
    getSseCounts,
    registry: METRIC_CATALOG,
    kindForMetric,
    promRegistry,
    getMetricsText() {
      return promRegistry.metrics();
    },
    flushNow() {
      return buffer.flushNow();
    },
    stop() {
      buffer.stop();
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
