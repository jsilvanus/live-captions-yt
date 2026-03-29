import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmpDir = os.tmpdir();
const DB_PATH = path.join(tmpDir, `lcyt-backend-debug-bridge-${Date.now()}.db`);
process.env.DB_PATH = DB_PATH;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'test-admin-key';
process.env.GRAPHICS_ENABLED = '0';
process.env.FREE_APIKEY_ACTIVE = '0';
process.env.PLAYWRIGHT_DSK_CHROMIUM = '';
process.env.ALLOWED_DOMAINS = '*';

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

function spawnEchoServer(port) {
  const proc = spawn(process.execPath, ['packages/tools/tcp-echo-server/server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(process.stdout);
  proc.stderr.pipe(process.stderr);
  return proc;
}

(async function(){
  const echoPort = await getFreePort();
  const echo = spawnEchoServer(echoPort);

  // wait a bit
  await new Promise(r => setTimeout(r, 300));

  const { createTestServer } = await import('./test-server.js');
  const { app, db, bridgeManager: productionBridgeManager } = createTestServer(DB_PATH);
  const srv = app.listen(0);
  await new Promise((res, rej) => srv.once('listening', res).once('error', rej));
  const port = srv.address().port;
  const baseUrl = 'http://127.0.0.1:' + port;
  console.log('backend baseUrl', baseUrl);

  const fetch = global.fetch;
  const createRes = await fetch(`${baseUrl}/production/bridge/instances`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'test-bridge' })
  });
  console.log('create status', createRes.status);
  const created = await createRes.json();
  console.log('created', created);
  const tokenMatch = /BRIDGE_TOKEN=(\w+)/.exec(created.envContent);
  const token = tokenMatch ? tokenMatch[1] : null;
  console.log('token', token);

  const bridgeProc = spawn(process.execPath, ['packages/lcyt-bridge/src/index.js'], {
    env: { ...process.env, BACKEND_URL: baseUrl, BRIDGE_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridgeProc.stdout.pipe(process.stdout);
  bridgeProc.stderr.pipe(process.stderr);

  // wait for connect
  await new Promise(r => setTimeout(r, 500));
  console.log('isConnected', productionBridgeManager.isConnected(created.id));

  const cmdRes = await fetch(`${baseUrl}/production/bridge/instances/${created.id}/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'tcp_send', host: '127.0.0.1', port: echoPort, payload: 'hello' })
  });
  console.log('cmd status', cmdRes.status);
  const body = await cmdRes.text();
  console.log('cmd body', body);

  // cleanup
  try{ srv.close(); } catch {}
  try{ echo.kill(); } catch {}
  try{ bridgeProc.kill(); } catch {}
})();
