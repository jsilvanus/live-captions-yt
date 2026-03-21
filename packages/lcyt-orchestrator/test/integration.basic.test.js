// Guarded integration test for orchestrator. Set TEST_ORCHESTRATOR=1 to run.
const http = require('http');
const assert = require('assert');

if (!process.env.TEST_ORCHESTRATOR) {
  console.log('TEST_ORCHESTRATOR not set — skipping orchestrator integration test');
  process.exit(0);
}

(async () => {
  try {
    const app = require('../src/index.js');
    const server = app.listen(4010);

    // register a worker
    const reg = JSON.stringify({ id: 'w1', privateIp: '127.0.0.1', maxJobs: 1 });
    const regResp = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 4010, path: '/compute/workers/register', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reg) } }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', reject);
      req.write(reg);
      req.end();
    });
    assert.strictEqual(regResp.statusCode, 200);

    // post a job
    const job = JSON.stringify({ id: 'job1', type: 'hls' });
    const jobResp = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 4010, path: '/compute/jobs', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(job) } }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', reject);
      req.write(job);
      req.end();
    });

    assert.strictEqual(jobResp.statusCode, 200, 'expected job to be assigned');
    const json = JSON.parse(jobResp.body);
    assert.ok(json.workerId, 'response should include workerId');

    // second job should be rejected (maxJobs=1)
    const job2 = JSON.stringify({ id: 'job2', type: 'hls' });
    const job2Resp = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 4010, path: '/compute/jobs', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(job2) } }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', reject);
      req.write(job2);
      req.end();
    });

    assert.strictEqual(job2Resp.statusCode, 503, 'expected 503 when no capacity');

    await new Promise(r => server.close(r));
    console.log('orchestrator integration test passed');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(2);
  }
})();
