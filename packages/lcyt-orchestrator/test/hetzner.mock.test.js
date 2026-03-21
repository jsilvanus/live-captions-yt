// Simple unit tests for Hetzner burst flow using a fake Hetzner HTTP server
const http = require('http');
const assert = require('assert');

async function run() {
  // Start fake Hetzner API server
  let createCalled = 0;
  let getCalls = 0;
  let createdId = 'srv-mock-1';

  const hetzner = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/servers') {
      createCalled += 1;
      let body = '';
      req.on('data', c => body += c.toString());
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ server: { id: createdId, name: 'mock', status: 'building' } }));
      });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/servers/')) {
      getCalls += 1;
      // After 2 GETs, return running
      const state = getCalls >= 2 ? 'running' : 'building';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ server: { id: createdId, status: state } }));
      return;
    }

    // default
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((r) => hetzner.listen(0, '127.0.0.1', r));
  const hetznerPort = hetzner.address().port;

  // Start orchestrator app with HETZNER pointing to fake server
  process.env.HETZNER_API_TOKEN = 'test-token';
  process.env.HETZNER_API_BASE_URL = `http://127.0.0.1:${hetznerPort}`;
  process.env.MAX_CONCURRENT_BURST_CREATES = '1';
  process.env.ORCHESTRATOR_MAX_PENDING_JOBS = '5';

  const app = require('../src/index.js');
  const srv = app.listen(4111);

  // Post a job when no workers: should enqueue and trigger create
  const job = JSON.stringify({ id: 'job-1', type: 'hls' });
  const jobResp = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 4111, path: '/compute/jobs', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(job) } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(job);
    req.end();
  });

  assert.strictEqual(jobResp.statusCode, 202, 'expected 202 queued result');

  // Wait a short while for the orchestrator to request create and poll
  await new Promise(r => setTimeout(r, 1500));
  assert.ok(createCalled >= 1, 'expected create to be called on fake Hetzner');

  // Now simulate the worker registering (e.g., after server boots)
  const reg = JSON.stringify({ id: 'burst-1', privateIp: '127.0.0.1', maxJobs: 2 });
  const regResp = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 4111, path: '/compute/workers/register', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reg) } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(reg);
    req.end();
  });
  assert.strictEqual(regResp.statusCode, 200);

  // After registration, the pending job should be assigned to burst-1
  const workersResp = await new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: 4111, path: '/compute/workers' }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });
  assert.strictEqual(workersResp.statusCode, 200);
  const wjson = JSON.parse(workersResp.body);
  const burst = wjson.workers.find(w => w.id === 'burst-1');
  assert.ok(burst, 'burst worker should be present');
  assert.strictEqual(burst.jobCount, 1, 'pending job should have been assigned to new worker');

  // Cleanup
  await new Promise(r => srv.close(r));
  await new Promise(r => hetzner.close(r));
  console.log('hetzner.mock.test.js passed');
}

run().catch(err => {
  console.error(err && err.stack || err);
  process.exit(2);
});
