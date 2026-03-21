// Simple in-memory Prometheus-style counters and gauge exporter
const metrics = {
  burst_vm_created_total: 0,
  burst_vm_destroyed_total: 0,
  hetzner_rate_limit_backoff_total: 0,
  active_workers: 0
};

export function inc(name, n = 1) { if (metrics[name] !== undefined) metrics[name] += n; }
export function set(name, value) { if (metrics[name] !== undefined) metrics[name] = value; }
export function getAll() { return Object.assign({}, metrics); }
export default { inc, set, getAll };
