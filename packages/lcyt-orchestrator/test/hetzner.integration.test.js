const http = require('http');
const assert = require('assert');

async function run() {
  // Start mock Hetzner API server
  let createCalls = 0;
  let getCalls = 0;
  const serverId = 'srv-int-1';

  const hetzner = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/servers') {
      createCalls += 1;
      let body = '';
      req.on('data', c => body += c.toString());
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ server: { id: serverId, name: 'mock-int', status: 'building' } }));
      });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/servers/')) {
      getCalls += 1;
      // Simulate a 429 rate-limit on first GET, then build -> running
      if (getCalls === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rate limit' }));
        return;
      }

      if (getCalls <= 3) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ server: { id: serverId, status: 'building' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ server: { id: serverId, status: 'running' } }));
      return;
    }

    // default
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((r) => hetzner.listen(0, '127.0.0.1', r));
  const hetznerPort = hetzner.address().port;

  // Configure env for fast, deterministic test
  process.env.HETZNER_API_TOKEN = 'test-token';
  process.env.HETZNER_API_BASE_URL = `http://127.0.0.1:${hetznerPort}`;
  process.env.MAX_CONCURRENT_BURST_CREATES = '1';
  process.env.ORCHESTRATOR_MAX_PENDING_JOBS = '2';
  process.env.ORCHESTRATOR_BACKOFF_MS = '20';
  process.env.ORCHESTRATOR_HETZNER_TIMEOUT_MS = '5000';

  // Start orchestrator app in-process
  const app = require('../src/index.js');
  const PORT = 4123;
  const srv = app.listen(PORT);

  // Helper to post job
  function postJob(id) {
    const payload = JSON.stringify({ id, type: 'hls' });
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/compute/jobs', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // Post three jobs: with ORCHESTRATOR_MAX_PENDING_JOBS=2 we expect 202,202,503
  const r1 = await postJob('job-1');
  const r2 = await postJob('job-2');
  const r3 = await postJob('job-3');

  assert.strictEqual(r1.statusCode, 202, 'job-1 should be queued (202)');
  assert.strictEqual(r2.statusCode, 202, 'job-2 should be queued (202)');
  assert.strictEqual(r3.statusCode, 503, 'job-3 should be rejected when pending queue full (503)');

  // Wait for orchestrator to call Hetzner create and start polling (allow backoff retries)
  await new Promise(r => setTimeout(r, 800));
  assert.ok(createCalls >= 1, 'expected createBurstServer to be called at least once');
  assert.ok(getCalls >= 1, 'expected poll requests to be made (including a 429)');

  // Now simulate burst worker registering after server is ready
  const reg = JSON.stringify({ id: 'burst-1', privateIp: '127.0.0.1', maxJobs: 2 });
  const regResp = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/compute/workers/register', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reg) } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(reg);
    req.end();
  });
  assert.strictEqual(regResp.statusCode, 200, 'worker register should succeed');

  // Query workers and assert pending jobs were assigned
  const workersResp = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: '/compute/workers' }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });

  assert.strictEqual(workersResp.statusCode, 200);
  const wjson = JSON.parse(workersResp.body);
  const burst = wjson.workers.find(w => w.id === 'burst-1');
  assert.ok(burst, 'burst worker should be present');
  assert.strictEqual(burst.jobCount, 2, 'pending jobs should be assigned to new worker');

  // Ensure we observed a 429 response served by mock Hetzner
  assert.ok(getCalls >= 1, 'expected at least one GET to Hetzner (includes 429)');

  // Cleanup
  await new Promise(r => srv.close(r));
  await new Promise(r => hetzner.close(r));
  console.log('hetzner.integration.test.js passed');
}

run().catch(err => {
  console.error(err && err.stack || err);
  process.exit(2);
});
