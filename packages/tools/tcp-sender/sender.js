#!/usr/bin/env node
/**
 * tcp-sender — minimal TCP command sender for bridge/hardware testing.
 *
 * Opens a TCP connection to a host:port, writes a single command payload,
 * prints whatever the remote end sends back within a short window, then
 * closes the connection. Useful for manually testing lcyt-bridge TCP
 * targets (the tcp-echo-server, or real AMX/Roland hardware) without
 * spinning up the full bridge agent or lcyt-web UI.
 *
 * A NetLinx bridge reply to a query-style Roland command (e.g.
 * "ROLAND:CUSTOM:QIS;") comes back as "ROLAND:REPLY:<text>;" — this is
 * additionally parsed out and printed on its own line.
 *
 * Usage:
 *   node sender.js <host> <port> <command>
 *
 * Environment variables:
 *   TIMEOUT_MS   How long to wait for a response before closing (default: 2000)
 *
 * Examples:
 *   node sender.js 127.0.0.1 9999 PING
 *   node sender.js 192.168.1.50 6500 "CAM1:PRESET:3;"
 *   TIMEOUT_MS=5000 node sender.js 192.168.1.50 6500 "CAM1:MOVE:UP;"
 */

import { createConnection } from 'node:net';

const [, , host, portArg, ...commandParts] = process.argv;
const port = Number(portArg);
const command = commandParts.join(' ');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 2000);

if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || !command) {
  console.error('Usage: node sender.js <host> <port> <command>');
  console.error('Example: node sender.js 127.0.0.1 9999 "CAM1:PRESET:3;"');
  process.exit(1);
}

const socket = createConnection({ host, port }, () => {
  console.log(`[sender] Connected to ${host}:${port}`);
  console.log(`[sender] → ${JSON.stringify(command)}`);
  socket.write(command);
});

socket.on('data', (chunk) => {
  const text = chunk.toString();
  console.log(`[sender] ← ${JSON.stringify(text)}`);
  const rolandReply = /ROLAND:REPLY:(.+?);/.exec(text);
  if (rolandReply) {
    console.log(`[sender] Roland reply: ${rolandReply[1]}`);
  }
});

socket.on('error', (err) => {
  console.error(`[sender] Error: ${err.message}`);
  process.exitCode = 1;
});

socket.on('close', () => {
  console.log('[sender] Connection closed');
});

setTimeout(() => {
  socket.end();
}, TIMEOUT_MS);
