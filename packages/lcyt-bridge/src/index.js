#!/usr/bin/env node
/**
 * lcyt-bridge — production control relay agent
 *
 * Reads config from .env in the same directory as the executable (or cwd).
 * Required variables: BACKEND_URL, BRIDGE_TOKEN
 *
 * Run:  node src/index.js
 * Exe:  lcyt-bridge.exe (built with pkg)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

// ---------------------------------------------------------------------------
// Load .env from the same directory as the executable (or fallback to cwd)
// ---------------------------------------------------------------------------

function loadConfig() {
  // When running as a pkg exe, process.execPath is the .exe; src/index.js is
  // compiled in, so __dirname points inside the pkg snapshot. We use
  // process.execPath's directory for the real .env location.
  const exeDir = process.pkg
    ? dirname(process.execPath)
    : dirname(fileURLToPath(import.meta.url));

  const envPath = join(exeDir, '.env');

  let vars = {};
  if (existsSync(envPath)) {
    try {
      vars = parseDotenv(readFileSync(envPath, 'utf8'));
    } catch (e) {
      console.warn(`[lcyt-bridge] Could not parse .env at ${envPath}: ${e.message}`);
    }
  }

  // Merge with process.env (process.env takes precedence over .env file)
  const get = (key) => process.env[key] ?? vars[key];

  const backendUrl = get('BACKEND_URL') || 'https://api.lcyt.fi';
  const token      = get('BRIDGE_TOKEN');

  return { backendUrl, token };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const config = loadConfig();
const version = getVersion();

process.title = `lcyt-bridge v${version}`;
console.info(`[lcyt-bridge] v${version} starting`);
console.info(`[lcyt-bridge] Backend: ${config.backendUrl}`);

// No token — run a health check against the backend and exit.
if (!config.token) {
  console.info('[lcyt-bridge] No BRIDGE_TOKEN configured — running health check and exiting.');
  console.info('[lcyt-bridge] Set BACKEND_URL and BRIDGE_TOKEN in a .env file to run as a relay agent.');
  try {
    const res = await fetch(`${config.backendUrl}/health`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      console.info(`[lcyt-bridge] Backend healthy: ${JSON.stringify(body)}`);
      process.exit(0);
    } else {
      console.warn(`[lcyt-bridge] Backend returned HTTP ${res.status}: ${JSON.stringify(body)}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[lcyt-bridge] Health check failed: ${err.message}`);
    process.exit(1);
  }
}

const { Bridge } = await import('./bridge.js');
const { createTray } = await import('./tray.js');

const bridge = new Bridge(config);

// System tray (optional — gracefully skipped if unavailable)
createTray({
  bridge,
  onQuit() {
    console.info('[lcyt-bridge] Quit requested from tray');
    bridge.destroy();
    process.exit(0);
  },
});

// Start the bridge
bridge.start();
bridge.startHeartbeat(30_000);

// Graceful shutdown on Ctrl+C / SIGTERM
function shutdown() {
  console.info('[lcyt-bridge] Shutting down…');
  bridge.destroy();
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

console.info('[lcyt-bridge] Running. Press Ctrl+C to quit.');

// ---------------------------------------------------------------------------

function getVersion() {
  // __BRIDGE_VERSION__ is replaced at build time by scripts/build.cjs via esbuild --define.
  // Falls back to reading package.json when running directly with `node src/index.js`.
  if (typeof __BRIDGE_VERSION__ !== 'undefined') return __BRIDGE_VERSION__;
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const pkg   = JSON.parse(readFileSync(join(__dir, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '?';
  } catch {
    return '?';
  }
}
