import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrometheus, summarizeFleet, createFleetPoller } from '../src/metrics/fleet-poller.js';

const SCRAPE = `# HELP fffleet_workers Registered workers.
# TYPE fffleet_workers gauge
fffleet_workers 2
fffleet_worker_slots{worker="a",pool="static"} 4
fffleet_worker_slots{worker="b",pool="hetzner"} 2
fffleet_worker_slots_used{worker="a",pool="static"} 3
fffleet_worker_draining{worker="b"} 1
fffleet_queue_length{class="batch"} 5
fffleet_queue_length{class="live"} 1
fffleet_autoscaler_creates_total{pool="hetzner",result="ok"} 3
fffleet_autoscaler_creates_total{pool="hetzner",result="error"} 1
fffleet_workers_lost_total 2
broken line here
`;

describe('fleet poller', () => {
  it('parses Prometheus text and skips junk', () => {
    const s = parsePrometheus(SCRAPE);
    assert.equal(s.find(x => x.name === 'fffleet_workers').value, 2);
    assert.deepEqual(s.find(x => x.name === 'fffleet_worker_slots').labels, { worker: 'a', pool: 'static' });
  });

  it('summarizes the fleet', () => {
    const f = summarizeFleet(parsePrometheus(SCRAPE));
    assert.equal(f.workers, 2);
    assert.equal(f.slots, 6);
    assert.equal(f.slotsUsed, 3);
    assert.equal(f.queued, 6);
    assert.equal(f.autoscalerCreates, 4);
    assert.equal(f.autoscalerCreateFailures, 1);
    assert.equal(f.workersLost, 2);
  });

  it('is off without FFFLEET_URL', () => {
    assert.equal(createFleetPoller({ env: {} }), null);
  });

  it('polls with the static token and reports failures', async () => {
    const calls = [];
    let status = 200;
    const f = async (url, init) => { calls.push({ url, auth: init.headers.authorization }); return { ok: status === 200, status, text: async () => SCRAPE }; };
    const p = createFleetPoller({ env: { FFFLEET_URL: 'http://fleet:8080/', FFFLEET_TOKEN: 't' }, fetch: f, intervalMs: 3_600_000 });
    const snap = await p.poll();
    p.stop();
    assert.equal(snap.ok, true);
    assert.equal(calls[0].url, 'http://fleet:8080/metrics');
    assert.equal(calls[0].auth, 'Bearer t');
    status = 403;
    const failed = await createFleetPoller({ env: { FFFLEET_URL: 'http://fleet:8080', FFFLEET_TOKEN: 't' }, fetch: f, intervalMs: 3_600_000 }).poll();
    assert.equal(failed.ok, false);
    assert.match(failed.error, /metrics scope/);
  });

  it('logs in with client credentials at scope metrics and retries once on 401', async () => {
    const scopes = [];
    const tokens = [];
    const mk = ({ scope }) => { scopes.push(scope); let n = 0; return { get: async () => `tok${++n}` }; };
    let first = true;
    const f = async (url, init) => {
      tokens.push(init.headers.authorization);
      if (first) { first = false; return { ok: false, status: 401, text: async () => '' }; }
      return { ok: true, status: 200, text: async () => SCRAPE };
    };
    const p = createFleetPoller({ env: { FFFLEET_URL: 'http://x', FFFLEET_CLIENT_ID: 'c', FFFLEET_CLIENT_SECRET: 's' }, fetch: f, createTokenProvider: mk, intervalMs: 3_600_000 });
    await new Promise(r => setTimeout(r, 20)); // let the constructor's first poll settle
    const snap = await p.poll();
    p.stop();
    assert.equal(snap.ok, true);
    assert.deepEqual(scopes, ['metrics']);
    assert.equal(tokens[0], 'Bearer tok1');
    assert.equal(tokens[1], 'Bearer tok2');
  });

  it('accounts burst VM seconds and created VMs into usage metrics', async () => {
    const counts = [];
    const metrics = { count: (name, n) => counts.push([name, n]) };
    let body = `fffleet_autoscaler_instances{pool="h",state="ready"} 2
fffleet_autoscaler_instances{pool="h",state="removing"} 1
fffleet_autoscaler_creates_total{pool="h",result="ok"} 2
`;
    const f = async () => ({ ok: true, status: 200, text: async () => body });
    const p = createFleetPoller({ metrics, env: { FFFLEET_URL: 'http://x', FFFLEET_TOKEN: 't' }, fetch: f, intervalMs: 10_000 });
    await new Promise(r => setTimeout(r, 20));
    counts.length = 0;
    await new Promise(r => setTimeout(r, 1100));
    body = body.replace('result="ok"} 2', 'result="ok"} 3');
    const snap = await p.poll();
    p.stop();
    assert.equal(snap.burstVms, 2);
    const secs = counts.filter(c => c[0] === 'compute.burst_vm_seconds').reduce((a, c) => a + c[1], 0);
    assert.ok(secs >= 2 && secs <= 6, `vm seconds ${secs}`);
    assert.deepEqual(counts.filter(c => c[0] === 'compute.burst_vms_created'), [['compute.burst_vms_created', 1]]);
  });
});
