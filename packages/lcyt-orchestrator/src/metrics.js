// prom-client-backed metrics with the original inc(name, n) / set(name, v)
// facade, so all call sites in index.js keep working unchanged
// (plan_metering_audit §4.3). Fixes the old hand-rolled exporter's bug where
// active_workers (a gauge) was emitted with `# TYPE ... counter`.
import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const counters = {
  burst_vm_created_total: new Counter({ name: 'burst_vm_created_total', help: 'Burst VMs created', registers: [registry] }),
  burst_vm_destroyed_total: new Counter({ name: 'burst_vm_destroyed_total', help: 'Burst VMs destroyed', registers: [registry] }),
  burst_vm_seconds_total: new Counter({ name: 'burst_vm_seconds_total', help: 'Total burst VM lifetime in seconds', registers: [registry] }),
  hetzner_rate_limit_backoff_total: new Counter({ name: 'hetzner_rate_limit_backoff_total', help: 'Job dispatches deferred because no worker had capacity', registers: [registry] }),
};

const gauges = {
  active_workers: new Gauge({ name: 'active_workers', help: 'Registered workers', registers: [registry] }),
  burst_vms_active: new Gauge({ name: 'burst_vms_active', help: 'Registered burst workers', registers: [registry] }),
  orchestrator_jobs_pending: new Gauge({ name: 'orchestrator_jobs_pending', help: 'Jobs queued waiting for worker capacity', registers: [registry] }),
};

// Shadow values keep getAll() synchronous for tests and the burst-history
// totals endpoint (prom-client reads are async).
const values = Object.fromEntries([...Object.keys(counters), ...Object.keys(gauges)].map(k => [k, 0]));

export function inc(name, n = 1) {
  if (counters[name]) {
    counters[name].inc(n);
    values[name] += n;
  }
}

export function set(name, value) {
  if (gauges[name]) {
    gauges[name].set(value);
    values[name] = value;
  }
}

export function getAll() {
  return Object.assign({}, values);
}

export function metricsText() {
  return registry.metrics();
}

export default { inc, set, getAll, metricsText, registry };
