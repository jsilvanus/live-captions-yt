/**
 * AMX NetLinx mixer/switcher adapter.
 *
 * Used when an AMX NetLinx master controls a video router or switcher.
 * The switch commands are user-defined strings (verbatim TCP), just like
 * the camera AMX adapter. This lets any AMX-controlled matrix or router
 * work without code changes.
 *
 * connectionConfig shape:
 * {
 *   host: string,
 *   port: number,      // typically 1319
 *   inputs: [
 *     { number: 1, command: "SEND_COMMAND dvRouter,'INPUT-1'" },
 *     { number: 2, command: "SEND_COMMAND dvRouter,'INPUT-2'" },
 *     ...
 *   ]
 * }
 *
 * No command syntax is validated — the adapter sends exactly what is configured.
 */

import { createConnection } from 'node:net';

const RECONNECT_DELAY_MS = 5_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

export async function connect(config) {
  return new Promise((resolve) => {
    const { host, port = 1319 } = config;
    if (!host) {
      const handle = { connected: false, host: '', port, destroyed: false, _activeSource: null, _socket: null };
      console.warn('[amx-mixer] connectionConfig.host is required');
      resolve(handle);
      return;
    }

    const handle = {
      _socket: null,
      host,
      port,
      connected: false,
      destroyed: false,
      _activeSource: null,
      _reconnectTimer: null,
    };

    function openSocket(onFirstConnect) {
      if (handle.destroyed) return;
      const socket = createConnection({ host, port }, () => {
        handle.connected = true;
        socket.setKeepAlive(true, KEEPALIVE_INTERVAL_MS);
        console.info(`[amx-mixer] Connected to ${host}:${port}`);
        if (onFirstConnect) onFirstConnect();
      });

      socket.on('error', (err) => {
        handle.connected = false;
        console.warn(`[amx-mixer] ${host}:${port} error: ${err.message}`);
      });

      socket.on('close', () => {
        handle.connected = false;
        handle._socket = null;
        if (!handle.destroyed) {
          console.info(`[amx-mixer] ${host}:${port} disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
          handle._reconnectTimer = setTimeout(() => openSocket(null), RECONNECT_DELAY_MS);
        }
      });

      handle._socket = socket;
    }

    const resolveTimer = setTimeout(() => resolve(handle), 3_000);
    openSocket(() => { clearTimeout(resolveTimer); resolve(handle); });
  });
}

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
 * Switch the video source to the given input number.
 * Looks up inputNumber in connectionConfig.inputs, sends command verbatim.
 *
 * @param {object} handle
 * @param {number} inputNumber  1-based input number
 * @param {object} mixer        mixer row with connectionConfig already parsed
 */
export async function switchSource(handle, inputNumber, mixer) {
  if (!handle.connected || !handle._socket) {
    throw new Error(`AMX mixer ${handle.host}:${handle.port} is not connected`);
  }
  const command = getSwitchCommand(mixer.connectionConfig, inputNumber);
  return new Promise((resolve, reject) => {
    handle._socket.write(command, 'utf8', (err) => {
      if (err) return reject(new Error(`AMX mixer TCP write failed: ${err.message}`));
      handle._activeSource = inputNumber;
      resolve();
    });
  });
}

/**
 * Return the currently active input, or null if unknown.
 * AMX does not report state — maintained in memory on each switchSource call.
 */
export function getActiveSource(handle) {
  return handle._activeSource;
}

/**
 * Build the TCP command string for switching to inputNumber.
 * Used by bridge routing (generates the string without executing the TCP send).
 *
 * @param {object} connectionConfig
 * @param {number} inputNumber
 * @returns {string} command string with CRLF terminator
 */
export function getSwitchCommand(connectionConfig, inputNumber) {
  const inputs = connectionConfig?.inputs ?? [];
  const entry = inputs.find(i => i.number === inputNumber);
  if (!entry) {
    throw new Error(`AMX mixer: no command configured for input ${inputNumber}`);
  }
  return entry.command + '\r\n';
}
