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
 * additionally parsed out and printed on its own line. --append (see
 * below) turns that into one accumulated line instead.
 *
 * --repl starts an interactive mode instead of sending a single command:
 * type a command, press Enter, and the status (connecting/sent/reply)
 * redraws in place on one line as it happens, settling once no more data
 * has arrived for REPL_IDLE_MS — then a newline is committed and the
 * prompt returns for the next command. By default each command gets its
 * own fresh connection (closed once its reply settles); --persistent
 * keeps one connection open for the whole REPL session instead,
 * reconnecting lazily the next time a command is sent after a drop.
 * --append works in both modes: instead of one console.log per step,
 * each step (connected/sent/reply/closed) is appended to a single line
 * separated by " → ", redrawn in place until the exchange finishes, at
 * which point a newline is committed. In --repl mode it also changes
 * the per-command line from overwrite-in-place to this accumulating
 * style.
 *
 * Usage:
 *   node sender.js <host> <port> <command> [--append]
 *   node sender.js <host> <port> --repl [--persistent] [--append]
 *
 * Environment variables:
 *   TIMEOUT_MS    How long to wait for a response before closing (default: 2000)
 *                 In --repl mode: how long to wait for the *first* byte of
 *                 a reply before giving up on that command.
 *   REPL_IDLE_MS  --repl mode only: how long to wait after the *last*
 *                 received byte before treating the reply as finished
 *                 (default: 300)
 *
 * Examples:
 *   node sender.js 127.0.0.1 9999 PING
 *   node sender.js 192.168.1.50 6500 "CAM1:PRESET:3;"
 *   TIMEOUT_MS=5000 node sender.js 192.168.1.50 6500 "CAM1:MOVE:UP;"
 *   node sender.js 192.168.1.50 6500 --repl --persistent
 *   node sender.js 192.168.1.50 6500 --repl --append
 */

import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [host, portArg, ...commandParts] = args.filter((a) => !a.startsWith('--'));
const port = Number(portArg);
const replMode = flags.has('--repl');
const persistent = flags.has('--persistent');
const appendMode = flags.has('--append');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 2000);
const REPL_IDLE_MS = Number(process.env.REPL_IDLE_MS ?? 300);

if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || (!replMode && commandParts.length === 0)) {
  console.error('Usage: node sender.js <host> <port> <command>');
  console.error('       node sender.js <host> <port> --repl [--persistent] [--append]');
  console.error('Example: node sender.js 127.0.0.1 9999 "CAM1:PRESET:3;"');
  console.error('Example: node sender.js 192.168.1.50 6500 --repl --persistent');
  process.exit(1);
}

if (replMode) {
  runRepl({ host, port, persistent, appendMode });
} else {
  runOnce({ host, port, command: commandParts.join(' '), appendMode });
}

// ---------------------------------------------------------------------------
// Single-shot mode
// ---------------------------------------------------------------------------

function runOnce({ host, port, command, appendMode }) {
  // Default: one console.log per step (unchanged from before --append
  // existed). --append instead redraws a single accumulated line,
  // separated by " → ", committing a newline once the socket closes.
  const parts = [];
  function render(text) {
    if (!appendMode) { console.log(text); return; }
    parts.push(text);
    process.stdout.write(`\r\x1b[K${parts.join(' → ')}`);
  }

  const socket = createConnection({ host, port }, () => {
    render(`[sender] Connected to ${host}:${port}`);
    render(`[sender] → ${JSON.stringify(command)}`);
    socket.write(command);
  });

  socket.on('data', (chunk) => {
    const text = chunk.toString();
    render(`[sender] ← ${JSON.stringify(text)}`);
    const rolandReply = /ROLAND:REPLY:(.+?);/.exec(text);
    if (rolandReply) {
      render(`[sender] Roland reply: ${rolandReply[1]}`);
    }
  });

  socket.on('error', (err) => {
    console.error(`[sender] Error: ${err.message}`);
    process.exitCode = 1;
  });

  socket.on('close', () => {
    render('[sender] Connection closed');
    if (appendMode) process.stdout.write('\n');
  });

  setTimeout(() => {
    socket.end();
  }, TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// REPL mode
// ---------------------------------------------------------------------------

function runRepl({ host, port, persistent, appendMode }) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  let socket = null; // only tracked/reused when persistent

  // Builds a renderer for one command's exchange: in overwrite mode each
  // call replaces the line (connecting → connected → sent → reply, in
  // turn); in --append mode each call is instead appended to the line,
  // separated by " → ", so the whole exchange stays visible.
  function makeRenderer() {
    const parts = [];
    return function render(text) {
      if (appendMode) {
        parts.push(text);
        process.stdout.write(`\r\x1b[K${parts.join(' → ')}`);
      } else {
        process.stdout.write(`\r\x1b[K${text}`);
      }
    };
  }

  function connect(render) {
    return new Promise((resolve, reject) => {
      render('[sender] connecting...');
      const sock = createConnection({ host, port });
      sock.once('connect', () => { render('[sender] connected'); resolve(sock); });
      sock.once('error', reject);
      if (persistent) {
        sock.on('close', () => {
          if (socket === sock) {
            socket = null;
            process.stdout.write('\n[sender] Disconnected — will reconnect on next command\n');
            rl.prompt();
          }
        });
      }
    });
  }

  async function getSocket(render) {
    if (persistent && socket && !socket.destroyed) return socket;
    const sock = await connect(render);
    if (persistent) socket = sock;
    return sock;
  }

  console.log(`[sender] REPL mode — ${persistent ? 'persistent' : 'per-command'} connection to ${host}:${port}. Type a command and press Enter ("exit" to quit).`);
  rl.prompt();

  rl.on('line', async (line) => {
    const command = line.trim();
    if (!command) { rl.prompt(); return; }
    if (command === 'exit' || command === 'quit') { rl.close(); return; }

    const render = makeRenderer();
    let sock;
    try {
      sock = await getSocket(render);
    } catch (err) {
      render(`[sender] Error: ${err.message}`);
      process.stdout.write('\n');
      rl.prompt();
      return;
    }

    let idleTimer = null;
    let done = false;

    const finalize = () => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      sock.removeListener('data', onData);
      sock.removeListener('error', onError);
      process.stdout.write('\n');
      if (!persistent) sock.end();
      rl.prompt();
    };

    const onData = (chunk) => {
      const text = chunk.toString();
      const rolandReply = /ROLAND:REPLY:(.+?);/.exec(text);
      render(rolandReply ? `[sender] Roland reply: ${rolandReply[1]}` : `[sender] ← ${JSON.stringify(text)}`);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finalize, REPL_IDLE_MS);
    };

    const onError = (err) => {
      render(`[sender] Error: ${err.message}`);
      finalize();
    };

    sock.on('data', onData);
    sock.on('error', onError);

    render(`[sender] → ${JSON.stringify(command)}`);
    sock.write(command);

    // Nothing received at all — give up after TIMEOUT_MS.
    idleTimer = setTimeout(finalize, TIMEOUT_MS);
  });

  rl.on('close', () => {
    if (socket) socket.destroy();
    process.exit(0);
  });
}
