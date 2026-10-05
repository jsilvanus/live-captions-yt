/**
 * fffleet orchestrator poller: reads GET /metrics (Prometheus text, scope
 * `metrics`) every 15 s and keeps the latest summary for the Admin "Fleet"
 * tile. Not configured (no FFFLEET_URL) means no poller and no tile.
 */
import logger from 'lcyt/logger';

/** Parse Prometheus text into [{ name, labels, value }]. Comments and malformed lines are skipped. */
export function parsePrometheus(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const value = Number(m[3]);
    if (!Number.isFinite(value)) continue;
    const labels = {};
    if (m[2]) {
      for (const l of m[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2].replace(/\\(.)/g, '$1');
    }
    out.push({ name: m[1], labels, value });
  }
  return out;
}

const sum = (samples, name, where = () => true) =>
  samples.filter(s => s.name === name && where(s.labels)).reduce((a, s) => a + s.value, 0);

/** Reduce an orchestrator scrape to the numbers the tile shows. */
export function summarizeFleet(samples) {
  const instances = {};
  for (const s of samples) {
    if (s.name === 'fffleet_autoscaler_instances') instances[s.labels.state || 'unknown'] = (instances[s.labels.state || 'unknown'] || 0) + s.value;
  }
  const queueByClass = {};
  for (const s of samples) {
    if (s.name === 'fffleet_queue_length') queueByClass[s.labels.class || 'default'] = s.value;
  }
  return {
    workers: sum(samples, 'fffleet_workers'),
    slots: sum(samples, 'fffleet_worker_slots'),
    slotsUsed: sum(samples, 'fffleet_worker_slots_used'),
    draining: sum(samples, 'fffleet_worker_draining'),
    queued: Object.values(queueByClass).reduce((a, b) => a + b, 0),
    queueByClass,
    autoscalerInstances: instances,
    autoscalerCreates: sum(samples, 'fffleet_autoscaler_creates_total'),
    autoscalerCreateFailures: sum(samples, 'fffleet_autoscaler_creates_total', l => l.result && l.result !== 'ok' && l.result !== 'success'),
    autoscalerDestroys: sum(samples, 'fffleet_autoscaler_destroys_total'),
    dispatchFailures: sum(samples, 'fffleet_dispatch_failures_total'),
    workersLost: sum(samples, 'fffleet_workers_lost_total'),
  };
}

export function createFleetPoller({ env = process.env, fetch: f = globalThis.fetch, intervalMs = 15_000, createTokenProvider = null } = {}) {
  const base = (env.FFFLEET_URL || env.COMPUTE_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  let latest = { ok: false, error: 'not polled yet', ts: 0 };
  let provider = null;

  async function authHeader({ refresh = false } = {}) {
    const staticToken = env.FFFLEET_TOKEN || env.COMPUTE_TOKEN;
    if (staticToken) return { authorization: `Bearer ${staticToken}` };
    if (env.FFFLEET_CLIENT_ID && env.FFFLEET_CLIENT_SECRET) {
      if (!provider) {
        const make = createTokenProvider || (await import('fffleet')).createTokenProvider;
        provider = make({ url: base, clientId: env.FFFLEET_CLIENT_ID, clientSecret: env.FFFLEET_CLIENT_SECRET, scope: 'metrics', fetch: f });
      }
      return { authorization: `Bearer ${await provider.get({ refresh })}` };
    }
    return {};
  }

  async function scrape(refresh) {
    const res = await f(`${base}/metrics`, { headers: await authHeader({ refresh }), signal: AbortSignal.timeout(5000) });
    if (res.status === 401 && !refresh && provider) return scrape(true);
    if (!res.ok) throw new Error(res.status === 403 ? 'HTTP 403 (token needs the metrics scope)' : `HTTP ${res.status}`);
    return res.text();
  }

  async function poll() {
    try {
      const text = await scrape(false);
      latest = { ok: true, ...summarizeFleet(parsePrometheus(text)), ts: Date.now() };
    } catch (err) {
      latest = { ok: false, error: err.message, ts: Date.now() };
      logger.warn(`[metrics] fleet poll failed: ${err.message}`);
    }
    return latest;
  }

  const timer = setInterval(() => { poll(); }, intervalMs);
  timer.unref();
  poll();
  return { poll, snapshot: () => latest, stop: () => clearInterval(timer) };
}
