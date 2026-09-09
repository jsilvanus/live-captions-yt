# `packages/tools/tcp-sender` — TCP Command Sender

Standalone development utility. Opens a TCP connection to a given host/port, sends a command payload, prints any response, then closes (or, in `--repl` mode, keeps prompting for more commands). Client-side counterpart to `packages/tools/tcp-echo-server` — used for manually testing `lcyt-bridge` TCP targets (the echo server, or real AMX/Roland hardware) without running the full bridge agent.

**Entry:** `sender.js`

**Usage:**
```
node sender.js <host> <port> <command> [--append]
node sender.js <host> <port> --repl [--persistent] [--append]
```

**Env:**
- `TIMEOUT_MS` — how long to wait for a response before closing (default: 2000). In `--repl` mode, how long to wait for the *first* byte of a reply before giving up on that command.
- `REPL_IDLE_MS` — `--repl` mode only: how long to wait after the last received byte before treating a reply as finished (default: 300).

**Roland reply parsing:** a NetLinx bridge's reply to a query-style Roland command (e.g. `ROLAND:CUSTOM:QIS;`) comes back over the socket as `ROLAND:REPLY:<text>;`; `sender.js` parses this out of the raw echo and prints it on its own `[sender] Roland reply: ...` line, in both single-shot and REPL mode.

**`--repl` mode:** sends several commands in a row without re-running the tool. Default is a fresh connection per command (closed once its reply settles); `--persistent` keeps one connection open for the whole session, reconnecting lazily on the next command after a drop. Status (connecting/connected/sent/reply) redraws in place on one line, settling once `REPL_IDLE_MS` has passed with no new data — then a newline is committed and the prompt returns. Type `exit`/`quit` to leave.

**`--append`:** works in both single-shot and REPL mode. Instead of one `console.log` per step, each step (connected/sent/reply/closed) is appended to a single redrawn line separated by ` → `, committing a final newline once the exchange finishes. Default (no flag) rendering is unchanged from before this existed.
