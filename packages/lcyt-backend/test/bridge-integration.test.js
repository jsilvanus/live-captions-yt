import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ECHO_SERVER_PATH = path.resolve(__dirname, '../../tools/tcp-echo-server/server.js');
const BRIDGE_PATH = path.resolve(__dirname, '../../lcyt-bridge/src/index.js');

const TEST_TIMEOUT_MS = 30_000;

// NOTE: Set env before importing the backend server module (it runs init on import)
// Use an in-memory DB for tests to avoid CI filesystem races.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'test-admin-key';
process.env.GRAPHICS_ENABLED = '0';
process.env.FREE_APIKEY_ACTIVE = '0';
process.env.PLAYWRIGHT_DSK_CHROMIUM = '';
process.env.ALLOWED_DOMAINS = '*';

// Helper: find a free TCP port
function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const addr = s.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

// Spawn the tcp echo server bundled with the repo
function spawnEchoServer(port) {
  const proc = spawn(process.execPath, [ECHO_SERVER_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return proc;
}

// Wait helper polling
async function waitFor(conditionFn, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await conditionFn()) return true;
    } catch (e) {
      // ignore transient errors
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('waitFor: timeout');
}

// Install a fail-safe killer to ensure processes are cleaned up if test framework times out
function killIfRunning(proc) {
  try {
    if (proc && !proc.killed) proc.kill();
  } catch {}
}

// Use node:test with a timeout so a hung import or spawn doesn't block indefinitely
test('bridge → tcp-echo integration', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const startedProcs = [];
  const cleanUp = () => {
    for (const p of startedProcs) killIfRunning(p);
  };
  t.after(cleanUp);

  // Allocate ports
  const echoPort = await getFreePort();

  // Start TCP echo server
  const echo = spawnEchoServer(echoPort);
  startedProcs.push(echo);

  // Wait for echo server to print listening message or accept a connection probe
  await waitFor(async () => {
    // Try to connect to the echo port to verify it's accepting
    return new Promise((res) => {
      const s = net.createConnection({ port: echoPort }, () => {
        s.end(); res(true);
      });
      s.on('error', () => res(false));
    });
  }, 5000, 100);

  // Use the lightweight test server helper (avoids importing full backend plugins)
  const { createTestServer } = await import('./test-server.js');
  const { app, db, bridgeManager: productionBridgeManager } = createTestServer();

  // Start test backend on ephemeral port
  const srv = app.listen(0);
  await new Promise((res, rej) => srv.once('listening', res).once('error', rej));
  startedProcs.push({ kill: () => srv.close() });
  // @ts-ignore
  const port = srv.address().port;
  const baseUrl = 'http://127.0.0.1:' + port;

  // Create a bridge instance via API
  const createRes = await fetch(`${baseUrl}/production/bridge/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'test-bridge' }),
  }).catch((e) => { cleanUp(); throw e; });

  if (createRes.status !== 201) {
    const body = await createRes.text().catch(() => '<no body>');
    cleanUp();
    throw new Error(`Failed to create bridge instance: ${createRes.status} ${body}`);
  }

  const created = await createRes.json();
  assert.ok(created.id && created.envContent, 'expected id and envContent');
  const instanceId = created.id;
  const tokenMatch = /BRIDGE_TOKEN=(\w+)/.exec(created.envContent);
  const token = tokenMatch ? tokenMatch[1] : null;
  assert.ok(token, 'token present in envContent');

  // Spawn bridge agent process pointing to our backend
  const bridgeProc = spawn(process.execPath, [BRIDGE_PATH], {
    env: { ...process.env, BACKEND_URL: baseUrl, BRIDGE_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  startedProcs.push(bridgeProc);

  // Wait until productionBridgeManager reports the instance as connected
  await waitFor(async () => productionBridgeManager.isConnected(instanceId), 5000, 200);

  // Send tcp_send command via public route — should transit to bridge → echo → status
  let cmdRes;
  let cmdJson;
  const maxRetries = 6;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    cmdRes = await fetch(baseUrl + '/production/bridge/instances/' + instanceId + '/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tcp_send', host: '127.0.0.1', port: echoPort, payload: 'hello-from-test' }),
    });

    if (cmdRes.status === 200) {
      cmdJson = await cmdRes.json();
      break;
    }

    const txt = await cmdRes.text().catch(() => '<no body>');
    if (txt.includes('not connected') && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    } else {
      cleanUp();
      throw new Error(`Bridge command failed: ${cmdRes.status} ${txt}`);
    }
  }

  assert.strictEqual(cmdRes.status, 200, `expected 200 but got ${cmdRes.status}`);
  assert.ok(cmdJson.ok === true, `expected ok=true, got ${JSON.stringify(cmdJson)}`);

  // Also verify DB last_seen updated for the instance row
  const row = db.prepare('SELECT * FROM prod_bridge_instances WHERE id = ?').get(instanceId);
  assert.ok(row, 'instance row exists in DB');
  assert.ok(row.last_seen, 'last_seen was updated');

  // Clean up
  cleanUp();
});
