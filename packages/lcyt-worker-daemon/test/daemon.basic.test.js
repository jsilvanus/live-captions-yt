// Simple smoke test for the worker daemon.
// Guarded: will skip unless TEST_WORKER_DAEMON=1 is set in environment.

const assert = require('assert');
const http = require('http');

if (!process.env.TEST_WORKER_DAEMON) {
  console.log('TEST_WORKER_DAEMON not set — skipping daemon.basic.test.js');
  process.exit(0);
}

(async () => {
  try {
    const mod = await import('../src/index.js');
    const { startServer } = mod;
    const srv = startServer(5000);

    // wait briefly for server
    await new Promise(r => setTimeout(r, 100));

    const payload = JSON.stringify({ planName: 'smoke' });
    const opts = {
      hostname: '127.0.0.1',
      port: 5000,
      path: '/jobs',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const respBody = await new Promise((resolve, reject) => {
      const req = http.request(opts, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', d => body += d);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    assert.strictEqual(respBody.statusCode, 200, 'expected 200 from POST /jobs');
    const obj = JSON.parse(respBody.body);
    assert.ok(obj.jobId, 'response must contain jobId');
    assert.ok(obj.workerId, 'response must contain workerId');

    await srv.stop();
    console.log('daemon.basic.test.js passed');
    process.exit(0);
  } catch (err) {
    console.error('test failed', err);
    process.exit(2);
  }
})();
