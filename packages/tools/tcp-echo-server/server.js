#!/usr/bin/env node
/**
 * tcp-echo-server — minimal TCP echo server for bridge connection testing.
 *
 * Listens for incoming TCP connections and echoes every received message
 * back to the sender.  The lcyt-bridge can use this server to verify that
 * a TCP route is alive without needing real AV hardware.
 *
 * Usage:
 *   node server.js [port]
 *
 * Environment variables:
 *   PORT   TCP port to listen on (default: 9999)
 *   HOST   Interface to bind to  (default: 0.0.0.0)
 *
 * Examples:
 *   node server.js                  # listen on 0.0.0.0:9999
 *   node server.js 7000             # listen on 0.0.0.0:7000
 *   PORT=8080 node server.js        # listen on 0.0.0.0:8080
 */

import { createServer } from 'node:net';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 9999);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = createServer((socket) => {
  const addr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[echo] Connection from ${addr}`);

  socket.on('data', (chunk) => {
    const msg = chunk.toString();
    process.stdout.write(`[echo] ${addr} → ${JSON.stringify(msg)}\n`);
    socket.write(chunk); // echo the raw bytes back
  });

  socket.on('end', () => {
    console.log(`[echo] ${addr} disconnected`);
  });

  socket.on('error', (err) => {
    console.error(`[echo] ${addr} error: ${err.message}`);
  });
});

server.listen(PORT, HOST, () => {
  const { address, port } = server.address();
  console.log(`[echo] TCP echo server listening on ${address}:${port}`);
  console.log(`[echo] Send any text to receive it back. Ctrl+C to stop.`);
});

server.on('error', (err) => {
  console.error(`[echo] Server error: ${err.message}`);
  process.exit(1);
});
