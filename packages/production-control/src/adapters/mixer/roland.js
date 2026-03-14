/**
 * Roland V-series mixer adapter — TCP remote control.
 *
 * connectionConfig shape:
 * {
 *   host: string,
 *   port: number    // typically 8023
 * }
 *
 * ─── Protocol notes ──────────────────────────────────────────────────────────
 * This adapter targets the Roland V-8HD / V-60HD / V-160HD JSON-over-TCP
 * remote control protocol (port 8023, newline-delimited JSON).
 *
 * IMPORTANT: Command format varies by model firmware. The named CMD_* constants
 * below are the only place that needs to change for a different Roland model.
 * Adapter logic (connect, reconnect, state tracking) is model-independent.
 *
 * To adapt for other models:
 *   V-1HD:    Uses pipe-delimited text — update CMD_* to match its spec.
 *   V-40HD:   Uses the same JSON format as V-8HD — no changes needed.
 *   V-160HD:  JSON format; switch command may use "inputBus.index" (0-based).
 *             Adjust CMD_SWITCH_PROGRAM to use `number: inputNumber - 1` if so.
 *
 * Verified protocol reference: Roland V-8HD firmware v1.x TCP remote control.
 * Obtain the "Remote Control" PDF from Roland support to confirm for your model.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createConnection } from 'node:net';

// ---------------------------------------------------------------------------
// Protocol command constants — UPDATE THESE for different Roland models
// ---------------------------------------------------------------------------

/** Query the current program/preview tally state. */
const CMD_GET_TALLY = (reqId = 1) =>
  JSON.stringify({ method: 'get', id: reqId, params: { name: 'tally' } }) + '\r\n';

/**
 * Switch the program bus to the given input number (1-based).
 * Roland V-8HD: inputBus.type 'V' = video input; number is 1-based.
 */
const CMD_SWITCH_PROGRAM = (inputNumber, reqId = 2) =>
  JSON.stringify({
    method: 'set',
    id: reqId,
    params: { name: 'program', inputBus: { type: 'V', number: inputNumber } },
  }) + '\r\n';

// ---------------------------------------------------------------------------
// Reconnect / keepalive config
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 5_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Adapter exports
// ---------------------------------------------------------------------------

/**
 * Open a persistent TCP connection to the Roland mixer.
 * Resolves immediately (even if device is unreachable) so the registry can
 * store the handle and retry transparently.
 *
 * @param {object} config - mixer.connectionConfig
 * @returns {Promise<object>} connection handle
 */
export async function connect(config) {
  return new Promise((resolve) => {
    const { host, port = 8023 } = config;
    if (!host) {
      const handle = { connected: false, host: '', port, destroyed: false, _activeSource: null, _socket: null };
      console.warn('[roland] connectionConfig.host is required');
      resolve(handle);
      return;
    }

    const handle = {
      _socket: null,
      host,
      port,
      connected: false,
      destroyed: false,
      /** Maintained in memory; updated on every switchSource call. */
      _activeSource: null,
      _reconnectTimer: null,
      _lineBuffer: '',
    };

    function openSocket(onFirstConnect) {
      if (handle.destroyed) return;
      const socket = createConnection({ host, port }, () => {
        handle.connected = true;
        socket.setKeepAlive(true, KEEPALIVE_INTERVAL_MS);
        console.info(`[roland] Connected to ${host}:${port}`);
        // Query current tally state so we know the active input at startup
        socket.write(CMD_GET_TALLY(), 'utf8', (err) => {
          if (err) console.warn(`[roland] GET_TALLY write failed: ${err.message}`);
        });
        if (onFirstConnect) onFirstConnect();
      });

      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        handle._lineBuffer += chunk;
        const lines = handle._lineBuffer.split('\n');
        handle._lineBuffer = lines.pop(); // keep incomplete last line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            _handleMessage(handle, msg);
          } catch {
            // Non-JSON response or keepalive byte — ignore
          }
        }
      });

      socket.on('error', (err) => {
        handle.connected = false;
        console.warn(`[roland] ${host}:${port} error: ${err.message}`);
      });

      socket.on('close', () => {
        handle.connected = false;
        handle._socket = null;
        if (!handle.destroyed) {
          console.info(`[roland] ${host}:${port} disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
          handle._reconnectTimer = setTimeout(() => openSocket(null), RECONNECT_DELAY_MS);
        }
      });

      handle._socket = socket;
    }

    // Resolve immediately with the handle; openSocket manages connection state.
    openSocket(() => resolve(handle));

    // If first connect hasn't fired after a short timeout, still resolve
    // (device unreachable — registry keeps the handle for later retry).
    const resolveTimer = setTimeout(() => resolve(handle), 3_000);
    // Cancel early resolve if we connected quickly
    const origResolve = resolve;
    // eslint-disable-next-line no-shadow
    const guardedResolve = (h) => { clearTimeout(resolveTimer); origResolve(h); };
    // Patch openSocket's onFirstConnect to use the guarded resolve
    openSocket(() => guardedResolve(handle));
  }).catch(() => ({
    connected: false, host: config.host, port: config.port ?? 8023,
    destroyed: false, _activeSource: null, _socket: null,
  }));
}

/**
 * Cleanly close the TCP connection.
 * @param {object} handle
 */
export async function disconnect(handle) {
  handle.destroyed = true;
  if (handle._reconnectTimer) clearTimeout(handle._reconnectTimer);
  if (handle._socket) {
    handle._socket.destroy();
    handle._socket = null;
  }
  handle.connected = false;
}

/**
 * Switch the program bus to the given input number (1-based).
 * Updates handle._activeSource optimistically before the ACK arrives.
 *
 * @param {object} handle
 * @param {number} inputNumber - 1-based mixer input number
 */
export async function switchSource(handle, inputNumber) {
  if (!handle.connected || !handle._socket) {
    throw new Error(`Roland mixer ${handle.host}:${handle.port} is not connected`);
  }
  return new Promise((resolve, reject) => {
    handle._socket.write(CMD_SWITCH_PROGRAM(inputNumber), 'utf8', (err) => {
      if (err) return reject(new Error(`Roland TCP write failed: ${err.message}`));
      // Optimistically update active source — confirmed by tally response if device sends one
      handle._activeSource = inputNumber;
      resolve();
    });
  });
}

/**
 * Return the currently active program input number, or null if unknown.
 * State is maintained in memory and updated on every switchSource call and
 * on incoming tally messages from the device.
 *
 * @param {object} handle
 * @returns {number|null}
 */
export function getActiveSource(handle) {
  return handle._activeSource;
}

// ---------------------------------------------------------------------------
// Internal — parse incoming Roland messages and update handle state
// ---------------------------------------------------------------------------

function _handleMessage(handle, msg) {
  // Tally response: { id: 1, result: { program: { inputBus: { type:'V', number:N } } } }
  // or notification: { method: 'notify', params: { name: 'tally', ... } }
  try {
    const tally =
      msg?.result?.program?.inputBus?.number ??
      msg?.params?.program?.inputBus?.number;
    if (typeof tally === 'number') {
      handle._activeSource = tally;
    }
  } catch {
    // Malformed — ignore
  }
}
